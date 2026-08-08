import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import {
  SCHEMA_VERSION,
  type ControlCenterSnapshot,
  type SnapshotEnvelope,
  type SnapshotMessage,
} from "./contracts.js";
import { noopLogger, type AppLogger } from "./logger.js";

export interface RealtimeHubOptions {
  heartbeatIntervalMs?: number;
  maximumBufferedBytes?: number;
  logger?: AppLogger;
}

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_MAXIMUM_BUFFERED_BYTES = 1_048_576;

export class RealtimeHub {
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly heartbeatIntervalMs: number;
  private readonly maximumBufferedBytes: number;
  private readonly logger: AppLogger;
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private readonly heartbeatHandle: ReturnType<typeof setInterval>;
  private revision = 1;
  private envelope: SnapshotEnvelope;
  private batchDepth = 0;
  private publishPending = false;
  private closed = false;

  constructor(
    private readonly projectSnapshot: () => ControlCenterSnapshot,
    options: RealtimeHubOptions = {},
  ) {
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.maximumBufferedBytes = options.maximumBufferedBytes ?? DEFAULT_MAXIMUM_BUFFERED_BYTES;
    this.logger = options.logger ?? noopLogger;
    this.envelope = this.createEnvelope();
    this.server.on("connection", (socket) => {
      this.alive.set(socket, true);
      socket.on("pong", () => this.alive.set(socket, true));
      socket.on("error", (error) => {
        this.logger.warn("websocket.client_error", { error: error.message });
      });
      this.send(socket, JSON.stringify(this.currentMessage()));
    });
    this.heartbeatHandle = setInterval(() => this.checkConnections(), this.heartbeatIntervalMs);
    this.heartbeatHandle.unref?.();
  }

  getRevision(): number {
    return this.revision;
  }

  getEnvelope(): SnapshotEnvelope {
    return structuredClone(this.envelope);
  }

  publish(): SnapshotEnvelope {
    if (this.batchDepth > 0) {
      this.publishPending = true;
      return this.getEnvelope();
    }
    return this.publishNow();
  }

  async batch<T>(operation: () => T | Promise<T>): Promise<T> {
    this.batchDepth += 1;
    let succeeded = false;
    try {
      const result = await operation();
      succeeded = true;
      return result;
    } finally {
      this.batchDepth -= 1;
      if (this.batchDepth === 0 && this.publishPending && succeeded) {
        this.publishPending = false;
        this.publishNow();
      } else if (this.batchDepth === 0 && !succeeded) {
        this.publishPending = false;
      }
    }
  }

  getClientCount(): number {
    return this.server.clients.size;
  }

  private publishNow(): SnapshotEnvelope {
    this.revision += 1;
    this.envelope = this.createEnvelope();
    const message = JSON.stringify(this.currentMessage());
    for (const client of this.server.clients) {
      if (client.readyState === WebSocket.OPEN) {
        this.send(client, message);
      }
    }
    return this.getEnvelope();
  }

  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname !== "/ws") return false;
    this.server.handleUpgrade(request, socket, head, (client) => {
      this.server.emit("connection", client, request);
    });
    return true;
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    clearInterval(this.heartbeatHandle);
    for (const client of this.server.clients) {
      client.close(1001, "Server shutting down");
    }
    return new Promise((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }

  private createEnvelope(): SnapshotEnvelope {
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: this.revision,
      snapshot: this.projectSnapshot(),
    };
  }

  private currentMessage(): SnapshotMessage {
    return { type: "snapshot", ...this.envelope };
  }

  private checkConnections(): void {
    for (const client of this.server.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (!this.alive.get(client) || client.bufferedAmount > this.maximumBufferedBytes) {
        this.logger.warn("websocket.client_terminated", {
          reason: this.alive.get(client) ? "slow_client" : "heartbeat_timeout",
          bufferedBytes: client.bufferedAmount,
        });
        client.terminate();
        continue;
      }
      this.alive.set(client, false);
      client.ping();
    }
  }

  private send(client: WebSocket, message: string): void {
    if (client.bufferedAmount > this.maximumBufferedBytes) {
      this.logger.warn("websocket.slow_client_terminated", {
        bufferedBytes: client.bufferedAmount,
      });
      client.terminate();
      return;
    }
    client.send(message, (error) => {
      if (error) this.logger.warn("websocket.send_failed", { error: error.message });
    });
  }
}
