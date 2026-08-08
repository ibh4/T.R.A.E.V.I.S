import { randomUUID } from "node:crypto";
import WebSocket, { type RawData } from "ws";
import type { AppLogger } from "../core/logger.js";
import type { EnabledRelayConfig } from "./relay-config.js";
import {
  RELAY_PROTOCOL_VERSION,
  RELAY_PROTOCOL_MESSAGE_MAX_BYTES,
  RELAY_RESPONSE_HEADERS,
  RELAY_RPC_RESPONSE_BODY_MAX_BYTES,
  RelayProtocolError,
  classifyRpcRequest,
  classifySnapshotRevision,
  createRelayErrorEnvelope,
  parseRelayMessage,
  parseRelayMessageJson,
  rpcRequestFingerprint,
  rpcTimeoutMsForPath,
  serializeRelayMessage,
  type AgentErrorMessage,
  type HeartbeatAckMessage,
  type HeartbeatMessage,
  type RelayErrorCode,
  type RelayMessage,
  type RelayMessageType,
  type RelaySnapshotMessage,
  type RpcRequestMessage,
  type RpcResponseMessage,
} from "./relay-protocol.js";

export type RelayCloudPhase = "stopped" | "connecting" | "handshaking" | "online" | "reconnecting";
export type RelayLocalPhase = "stopped" | "connecting" | "online" | "reconnecting";

export interface RelayAgentStatus {
  cloud: RelayCloudPhase;
  local: RelayLocalPhase;
  acceptingRpc: boolean;
  connectionId?: string;
  retryAttempt: number;
  localRetryAttempt: number;
  latestRevision?: number;
}

export interface RelayAgentOptions {
  config: EnabledRelayConfig;
  localHttpBaseUrl: string;
  localWebSocketUrl: string;
  logger: AppLogger;
  webSocketFactory?: (url: string) => WebSocket;
  fetch?: typeof fetch;
  now?: () => Date;
  rpcTimeoutForPath?: (path: string) => number;
}

interface CachedSnapshot {
  schemaVersion: RelaySnapshotMessage["schemaVersion"];
  revision: number;
  snapshot: RelaySnapshotMessage["snapshot"];
}

interface RpcRecord {
  request: RpcRequestMessage;
  fingerprint: string;
  promise?: Promise<RpcResponseMessage>;
  response?: RpcResponseMessage;
}

const RPC_HISTORY_LIMIT = 512;
const LOCAL_SNAPSHOT_FIELDS = new Set(["type", "schemaVersion", "revision", "snapshot"]);
const responseHeaderSet = new Set<string>(RELAY_RESPONSE_HEADERS);

export class RelayAgent {
  private readonly webSocketFactory: (url: string) => WebSocket;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly timeoutForPath: (path: string) => number;
  private cloudPhase: RelayCloudPhase = "stopped";
  private localPhase: RelayLocalPhase = "stopped";
  private cloudSocket: WebSocket | undefined;
  private localSocket: WebSocket | undefined;
  private cloudGeneration = 0;
  private localGeneration = 0;
  private started = false;
  private stopping = false;
  private acceptingRpc = false;
  private connectionId: string | undefined;
  private helloMessageId: string | undefined;
  private lastHeartbeatMessageId: string | undefined;
  private lastCloudActivityAt = 0;
  private retryAttempt = 0;
  private localRetryAttempt = 0;
  private localInitialSnapshot = false;
  private latestSnapshot: CachedSnapshot | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private localReconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  private cloudCloseReason = "connection_closed";
  private readonly rpcRecords = new Map<string, RpcRecord>();
  private readonly rpcControllers = new Map<string, AbortController>();
  private readonly activeRpcTasks = new Set<Promise<void>>();

  constructor(private readonly options: RelayAgentOptions) {
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.timeoutForPath = options.rpcTimeoutForPath ?? rpcTimeoutMsForPath;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.options.logger.info("relay.agent_started", {
      deviceId: this.options.config.deviceId,
      relayOrigin: new URL(this.options.config.url).origin,
    });
    this.connectLocal();
    this.connectCloud();
  }

  async stop(): Promise<void> {
    if (!this.started && !this.stopping) return;
    this.started = false;
    this.stopping = true;
    this.acceptingRpc = false;
    this.cloudPhase = "stopped";
    this.localPhase = "stopped";
    this.connectionId = undefined;
    this.clearCloudTimers();
    this.clearTimer("reconnect");
    this.clearTimer("localReconnect");
    for (const controller of this.rpcControllers.values()) controller.abort();

    const cloudSocket = this.cloudSocket;
    const localSocket = this.localSocket;
    this.cloudSocket = undefined;
    this.localSocket = undefined;
    this.cloudGeneration += 1;
    this.localGeneration += 1;
    await Promise.all([closeWebSocket(cloudSocket), closeWebSocket(localSocket)]);
    await Promise.allSettled([...this.activeRpcTasks]);
    this.rpcControllers.clear();
    this.rpcRecords.clear();
    this.activeRpcTasks.clear();
    this.stopping = false;
    this.options.logger.info("relay.agent_stopped", { deviceId: this.options.config.deviceId });
  }

  getStatus(): RelayAgentStatus {
    return {
      cloud: this.cloudPhase,
      local: this.localPhase,
      acceptingRpc: this.acceptingRpc,
      retryAttempt: this.retryAttempt,
      localRetryAttempt: this.localRetryAttempt,
      ...(this.connectionId === undefined ? {} : { connectionId: this.connectionId }),
      ...(this.latestSnapshot === undefined ? {} : { latestRevision: this.latestSnapshot.revision }),
    };
  }

  private connectCloud(): void {
    if (!this.started || this.cloudSocket) return;
    this.clearTimer("reconnect");
    this.cloudPhase = "connecting";
    this.acceptingRpc = false;
    this.connectionId = undefined;
    const url = new URL(this.options.config.url);
    url.searchParams.set("deviceId", this.options.config.deviceId);
    const socket = this.webSocketFactory(url.toString());
    const generation = ++this.cloudGeneration;
    this.cloudSocket = socket;
    this.cloudCloseReason = "connection_closed";
    this.options.logger.info("relay.cloud_connecting", {
      deviceId: this.options.config.deviceId,
      retryAttempt: this.retryAttempt,
    });

    socket.once("open", () => this.onCloudOpen(socket, generation));
    socket.on("message", (data) => this.onCloudMessage(socket, generation, data));
    socket.once("close", (code) => this.onCloudClose(socket, generation, code));
    socket.on("error", () => {
      if (this.cloudSocket === socket) {
        this.options.logger.warn("relay.cloud_socket_error", {
          deviceId: this.options.config.deviceId,
          phase: this.cloudPhase,
        });
      }
    });
  }

  private onCloudOpen(socket: WebSocket, generation: number): void {
    if (!this.isCurrentCloud(socket, generation)) return;
    this.cloudPhase = "handshaking";
    const helloMessageId = this.messageId("hello");
    this.helloMessageId = helloMessageId;
    this.sendCloud({
      ...this.messageBase("agent.hello", helloMessageId),
      type: "agent.hello",
      agentVersion: this.options.config.agentVersion,
      token: this.options.config.token,
    });
    this.handshakeTimer = setTimeout(() => {
      if (!this.isCurrentCloud(socket, generation) || this.cloudPhase !== "handshaking") return;
      this.cloudCloseReason = "handshake_timeout";
      this.options.logger.warn("relay.handshake_timeout", {
        deviceId: this.options.config.deviceId,
        timeoutMs: this.options.config.handshakeTimeoutMs,
      });
      socket.terminate();
    }, this.options.config.handshakeTimeoutMs);
  }

  private onCloudMessage(socket: WebSocket, generation: number, data: RawData): void {
    if (!this.isCurrentCloud(socket, generation)) return;
    let message: RelayMessage;
    try {
      if (rawDataByteLength(data) > RELAY_PROTOCOL_MESSAGE_MAX_BYTES) {
        throw new RelayProtocolError("MESSAGE_TOO_LARGE", "Relay message exceeds the maximum size");
      }
      message = parseRelayMessageJson(data.toString());
    } catch (error) {
      const code = error instanceof RelayProtocolError ? error.code : "INVALID_MESSAGE";
      this.options.logger.warn("relay.cloud_message_rejected", {
        deviceId: this.options.config.deviceId,
        phase: this.cloudPhase,
        code,
      });
      this.cloudCloseReason = "protocol_error";
      socket.close(1002, "Protocol error");
      return;
    }
    if (message.deviceId !== this.options.config.deviceId) {
      this.cloudCloseReason = "device_mismatch";
      socket.close(1008, "Device mismatch");
      return;
    }
    this.lastCloudActivityAt = this.now().getTime();

    if (this.cloudPhase === "handshaking") {
      this.handleHandshakeMessage(socket, message);
      return;
    }
    if (this.cloudPhase !== "online") return;

    if (message.type === "heartbeat.ack") {
      this.handleHeartbeatAck(message);
      return;
    }
    if (message.type === "heartbeat") {
      this.sendCloud({
        ...this.messageBase("heartbeat.ack"),
        type: "heartbeat.ack",
        ackForMessageId: message.messageId,
      });
      return;
    }
    if (message.type === "rpc.request") {
      if (!this.acceptingRpc) return;
      const task = this.processRpcRequest(message).catch(() => {
        this.options.logger.error("relay.rpc_processing_failed", {
          deviceId: this.options.config.deviceId,
          requestId: message.requestId,
        });
        if (this.started && this.cloudPhase === "online") {
          this.sendCloud(this.errorRpcResponse(
            message,
            500,
            "INTERNAL_ERROR",
            "Relay Agent failed to process the request",
            false,
          ));
        }
      });
      this.activeRpcTasks.add(task);
      void task.finally(() => this.activeRpcTasks.delete(task));
      return;
    }
    if (message.type === "agent.error") {
      this.options.logger.warn("relay.agent_error_received", {
        deviceId: this.options.config.deviceId,
        code: message.code,
        retryable: message.retryable,
        requestId: message.requestId,
      });
      return;
    }
    this.options.logger.warn("relay.cloud_message_unexpected", {
      deviceId: this.options.config.deviceId,
      type: message.type,
    });
  }

  private handleHandshakeMessage(socket: WebSocket, message: RelayMessage): void {
    if (message.type === "agent.error") {
      this.cloudCloseReason = "handshake_rejected";
      this.options.logger.warn("relay.handshake_rejected", {
        deviceId: this.options.config.deviceId,
        code: message.code,
        retryable: message.retryable,
      });
      socket.close(1008, "Handshake rejected");
      return;
    }
    if (message.type !== "agent.hello.ok"
      || message.ackForMessageId !== this.helloMessageId) {
      this.cloudCloseReason = "invalid_handshake_response";
      socket.close(1002, "Invalid handshake response");
      return;
    }
    this.clearTimer("handshake");
    this.cloudPhase = "online";
    this.connectionId = message.connectionId;
    this.acceptingRpc = true;
    this.retryAttempt = 0;
    this.lastCloudActivityAt = this.now().getTime();
    this.startHeartbeat();
    this.options.logger.info("relay.cloud_online", {
      deviceId: this.options.config.deviceId,
      connectionId: message.connectionId,
    });
    this.sendLatestSnapshot();
  }

  private handleHeartbeatAck(message: HeartbeatAckMessage): void {
    if (this.lastHeartbeatMessageId && message.ackForMessageId !== this.lastHeartbeatMessageId) {
      this.options.logger.warn("relay.heartbeat_ack_mismatch", {
        deviceId: this.options.config.deviceId,
        connectionId: this.connectionId,
      });
    }
  }

  private onCloudClose(socket: WebSocket, generation: number, code: number): void {
    if (!this.isCurrentCloud(socket, generation)) return;
    this.cloudSocket = undefined;
    this.cloudPhase = this.started ? "reconnecting" : "stopped";
    this.acceptingRpc = false;
    const connectionId = this.connectionId;
    this.connectionId = undefined;
    this.clearCloudTimers();
    this.options.logger.warn("relay.cloud_disconnected", {
      deviceId: this.options.config.deviceId,
      connectionId,
      closeCode: code,
      reason: this.cloudCloseReason,
      retryAttempt: this.retryAttempt,
    });
    this.scheduleCloudReconnect();
  }

  private scheduleCloudReconnect(): void {
    if (!this.started || this.reconnectTimer) return;
    this.retryAttempt += 1;
    const delayMs = retryDelay(
      this.retryAttempt,
      this.options.config.reconnectInitialMs,
      this.options.config.reconnectMaxMs,
    );
    this.cloudPhase = "reconnecting";
    this.options.logger.info("relay.cloud_reconnect_scheduled", {
      deviceId: this.options.config.deviceId,
      retryAttempt: this.retryAttempt,
      delayMs,
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connectCloud();
    }, delayMs);
  }

  private startHeartbeat(): void {
    this.clearTimer("heartbeat");
    this.heartbeatTimer = setInterval(() => {
      if (this.cloudPhase !== "online" || !this.cloudSocket) return;
      const silenceMs = this.now().getTime() - this.lastCloudActivityAt;
      if (silenceMs >= this.options.config.offlineTimeoutMs) {
        this.cloudCloseReason = "heartbeat_timeout";
        this.options.logger.warn("relay.heartbeat_timeout", {
          deviceId: this.options.config.deviceId,
          connectionId: this.connectionId,
          silenceMs,
        });
        this.cloudSocket.terminate();
        return;
      }
      const messageId = this.messageId("heartbeat");
      this.lastHeartbeatMessageId = messageId;
      const heartbeat: HeartbeatMessage = {
        ...this.messageBase("heartbeat", messageId),
        type: "heartbeat",
      };
      this.sendCloud(heartbeat);
    }, this.options.config.heartbeatMs);
    this.heartbeatTimer.unref?.();
  }

  private connectLocal(): void {
    if (!this.started || this.localSocket) return;
    this.clearTimer("localReconnect");
    this.localPhase = "connecting";
    const socket = this.webSocketFactory(this.options.localWebSocketUrl);
    const generation = ++this.localGeneration;
    this.localSocket = socket;
    this.localInitialSnapshot = true;
    socket.once("open", () => {
      if (!this.isCurrentLocal(socket, generation)) return;
      this.localPhase = "online";
      this.localRetryAttempt = 0;
      this.options.logger.info("relay.local_snapshot_connected", {
        deviceId: this.options.config.deviceId,
      });
    });
    socket.on("message", (data) => this.onLocalMessage(socket, generation, data));
    socket.once("close", (code) => this.onLocalClose(socket, generation, code));
    socket.on("error", () => {
      if (this.localSocket === socket) {
        this.options.logger.warn("relay.local_snapshot_socket_error", {
          deviceId: this.options.config.deviceId,
        });
      }
    });
  }

  private onLocalMessage(socket: WebSocket, generation: number, data: RawData): void {
    if (!this.isCurrentLocal(socket, generation)) return;
    let message: RelaySnapshotMessage;
    try {
      if (rawDataByteLength(data) > RELAY_PROTOCOL_MESSAGE_MAX_BYTES) {
        throw new RelayProtocolError("MESSAGE_TOO_LARGE", "Local snapshot exceeds the maximum size");
      }
      const value = JSON.parse(data.toString()) as unknown;
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new RelayProtocolError("INVALID_MESSAGE", "Local snapshot must be an object");
      }
      const record = value as Record<string, unknown>;
      if (Object.keys(record).some((key) => !LOCAL_SNAPSHOT_FIELDS.has(key))) {
        throw new RelayProtocolError("INVALID_MESSAGE", "Local snapshot contains unknown fields");
      }
      const parsed = parseRelayMessage({
        ...record,
        protocolVersion: RELAY_PROTOCOL_VERSION,
        deviceId: this.options.config.deviceId,
        messageId: this.messageId("snapshot"),
        sentAt: this.now().toISOString(),
      });
      if (parsed.type !== "snapshot") {
        throw new RelayProtocolError("INVALID_MESSAGE", "Local message is not a snapshot");
      }
      message = parsed;
    } catch (error) {
      this.options.logger.warn("relay.local_snapshot_rejected", {
        deviceId: this.options.config.deviceId,
        code: error instanceof RelayProtocolError ? error.code : "INVALID_JSON",
      });
      return;
    }

    const disposition = classifySnapshotRevision(this.latestSnapshot?.revision, message.revision);
    const initialSnapshot = this.localInitialSnapshot;
    this.localInitialSnapshot = false;
    if (disposition === "stale") {
      this.options.logger.warn("relay.local_snapshot_stale", {
        deviceId: this.options.config.deviceId,
        revision: message.revision,
        latestRevision: this.latestSnapshot?.revision,
      });
      return;
    }
    if (disposition === "new") {
      this.latestSnapshot = {
        schemaVersion: message.schemaVersion,
        revision: message.revision,
        snapshot: structuredClone(message.snapshot),
      };
      this.sendLatestSnapshot();
      return;
    }
    if (initialSnapshot) this.sendLatestSnapshot();
  }

  private onLocalClose(socket: WebSocket, generation: number, code: number): void {
    if (!this.isCurrentLocal(socket, generation)) return;
    this.localSocket = undefined;
    this.localPhase = this.started ? "reconnecting" : "stopped";
    this.options.logger.warn("relay.local_snapshot_disconnected", {
      deviceId: this.options.config.deviceId,
      closeCode: code,
      retryAttempt: this.localRetryAttempt,
    });
    this.scheduleLocalReconnect();
  }

  private scheduleLocalReconnect(): void {
    if (!this.started || this.localReconnectTimer) return;
    this.localRetryAttempt += 1;
    const delayMs = retryDelay(
      this.localRetryAttempt,
      this.options.config.reconnectInitialMs,
      this.options.config.reconnectMaxMs,
    );
    this.localPhase = "reconnecting";
    this.options.logger.info("relay.local_snapshot_reconnect_scheduled", {
      deviceId: this.options.config.deviceId,
      retryAttempt: this.localRetryAttempt,
      delayMs,
    });
    this.localReconnectTimer = setTimeout(() => {
      this.localReconnectTimer = undefined;
      this.connectLocal();
    }, delayMs);
  }

  private sendLatestSnapshot(): void {
    if (!this.latestSnapshot || this.cloudPhase !== "online") return;
    this.sendCloud({
      ...this.messageBase("snapshot"),
      type: "snapshot",
      schemaVersion: this.latestSnapshot.schemaVersion,
      revision: this.latestSnapshot.revision,
      snapshot: structuredClone(this.latestSnapshot.snapshot),
    });
  }

  private async processRpcRequest(request: RpcRequestMessage): Promise<void> {
    const existing = this.rpcRecords.get(request.requestId);
    const disposition = classifyRpcRequest(existing?.request, request);
    if (disposition === "conflict") {
      this.sendCloud(this.errorRpcResponse(
        request,
        409,
        "RPC_REQUEST_ID_CONFLICT",
        "requestId was already used with a different RPC payload",
        false,
      ));
      return;
    }
    if (disposition === "replay") {
      if (existing?.response) this.sendCloud(this.refreshRpcResponse(existing.response));
      return;
    }

    const record: RpcRecord = {
      request: structuredClone(request),
      fingerprint: rpcRequestFingerprint(request),
    };
    this.rpcRecords.set(request.requestId, record);
    const execution = this.executeRpc(request);
    record.promise = execution;
    const response = await execution;
    record.response = response;
    record.promise = undefined;
    this.pruneRpcHistory();
    if (this.started && this.cloudPhase === "online") this.sendCloud(this.refreshRpcResponse(response));
  }

  private async executeRpc(request: RpcRequestMessage): Promise<RpcResponseMessage> {
    const controller = new AbortController();
    const timeoutMs = this.timeoutForPath(request.path);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    this.rpcControllers.set(request.requestId, controller);
    const startedAt = this.now().getTime();
    try {
      const target = new URL(request.path, ensureTrailingSlash(this.options.localHttpBaseUrl));
      const expectedOrigin = new URL(this.options.localHttpBaseUrl).origin;
      if (target.origin !== expectedOrigin) {
        throw new RelayProtocolError("RPC_PATH_NOT_ALLOWED", "RPC target escaped the local backend origin");
      }
      const response = await this.fetchImpl(target, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: controller.signal,
      });
      const body = await readResponseBody(response);
      const relayResponse = parseRelayMessage({
        ...this.messageBase("rpc.response"),
        type: "rpc.response",
        requestId: request.requestId,
        status: response.status,
        headers: selectResponseHeaders(response.headers),
        body,
      });
      if (relayResponse.type !== "rpc.response") {
        throw new RelayProtocolError("INVALID_MESSAGE", "Local backend produced an invalid RPC response");
      }
      this.options.logger.info("relay.rpc_completed", {
        deviceId: this.options.config.deviceId,
        requestId: request.requestId,
        method: request.method,
        path: request.path,
        status: response.status,
        durationMs: this.now().getTime() - startedAt,
      });
      return relayResponse;
    } catch (error) {
      if (timedOut) {
        this.options.logger.warn("relay.rpc_timeout", {
          deviceId: this.options.config.deviceId,
          requestId: request.requestId,
          timeoutMs,
        });
        return this.errorRpcResponse(
          request,
          504,
          "RELAY_TIMEOUT",
          "Request timed out; local execution status is unknown",
          false,
        );
      }
      if (error instanceof RelayProtocolError) {
        this.options.logger.warn("relay.rpc_response_rejected", {
          deviceId: this.options.config.deviceId,
          requestId: request.requestId,
          code: error.code,
        });
        return this.errorRpcResponse(request, 502, error.code, "Local backend response was rejected", false);
      }
      this.options.logger.warn("relay.rpc_backend_unavailable", {
        deviceId: this.options.config.deviceId,
        requestId: request.requestId,
        stopped: this.stopping,
      });
      return this.errorRpcResponse(
        request,
        503,
        "COMPUTER_OFFLINE",
        "Local backend is unavailable; execution status may be unknown",
        false,
      );
    } finally {
      clearTimeout(timeout);
      if (this.rpcControllers.get(request.requestId) === controller) {
        this.rpcControllers.delete(request.requestId);
      }
    }
  }

  private errorRpcResponse(
    request: RpcRequestMessage,
    status: number,
    code: RelayErrorCode,
    message: string,
    retryable: boolean,
  ): RpcResponseMessage {
    const parsed = parseRelayMessage({
      ...this.messageBase("rpc.response"),
      type: "rpc.response",
      requestId: request.requestId,
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(createRelayErrorEnvelope(code, message, {
        requestId: request.requestId,
        retryable,
      })),
    });
    if (parsed.type !== "rpc.response") throw new Error("Failed to create RPC error response");
    return parsed;
  }

  private refreshRpcResponse(response: RpcResponseMessage): RpcResponseMessage {
    return {
      ...structuredClone(response),
      messageId: this.messageId("rpc_response"),
      sentAt: this.now().toISOString(),
    };
  }

  private pruneRpcHistory(): void {
    if (this.rpcRecords.size <= RPC_HISTORY_LIMIT) return;
    for (const [requestId, record] of this.rpcRecords) {
      if (record.promise) continue;
      this.rpcRecords.delete(requestId);
      if (this.rpcRecords.size <= RPC_HISTORY_LIMIT) break;
    }
  }

  private sendAgentError(code: RelayErrorCode, retryable: boolean, requestId?: string): void {
    const error: AgentErrorMessage = {
      ...this.messageBase("agent.error"),
      type: "agent.error",
      code,
      message: code,
      retryable,
      ...(requestId === undefined ? {} : { requestId }),
    };
    this.sendCloud(error);
  }

  private sendCloud(message: RelayMessage): boolean {
    const socket = this.cloudSocket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    let serialized: string;
    try {
      serialized = serializeRelayMessage(message);
    } catch (error) {
      this.options.logger.warn("relay.outbound_message_rejected", {
        deviceId: this.options.config.deviceId,
        type: message.type,
        code: error instanceof RelayProtocolError ? error.code : "INVALID_MESSAGE",
      });
      return false;
    }
    socket.send(serialized, (error) => {
      if (error) {
        this.options.logger.warn("relay.cloud_send_failed", {
          deviceId: this.options.config.deviceId,
          type: message.type,
        });
      }
    });
    return true;
  }

  private messageBase<TType extends RelayMessageType>(type: TType, messageId = this.messageId(type)) {
    return {
      type,
      protocolVersion: RELAY_PROTOCOL_VERSION,
      deviceId: this.options.config.deviceId,
      messageId,
      sentAt: this.now().toISOString(),
    } as const;
  }

  private messageId(prefix: string): string {
    return `${prefix.replace(/[^A-Za-z0-9]/g, "_")}_${randomUUID()}`;
  }

  private isCurrentCloud(socket: WebSocket, generation: number): boolean {
    return this.started && this.cloudSocket === socket && this.cloudGeneration === generation;
  }

  private isCurrentLocal(socket: WebSocket, generation: number): boolean {
    return this.started && this.localSocket === socket && this.localGeneration === generation;
  }

  private clearCloudTimers(): void {
    this.clearTimer("handshake");
    this.clearTimer("heartbeat");
    this.helloMessageId = undefined;
    this.lastHeartbeatMessageId = undefined;
  }

  private clearTimer(timer: "reconnect" | "localReconnect" | "handshake" | "heartbeat"): void {
    if (timer === "reconnect" && this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    } else if (timer === "localReconnect" && this.localReconnectTimer) {
      clearTimeout(this.localReconnectTimer);
      this.localReconnectTimer = undefined;
    } else if (timer === "handshake" && this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = undefined;
    } else if (timer === "heartbeat" && this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}

export function retryDelay(attempt: number, initialMs: number, maximumMs: number): number {
  return Math.min(maximumMs, initialMs * (2 ** Math.max(0, attempt - 1)));
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function rawDataByteLength(data: RawData): number {
  return Array.isArray(data)
    ? data.reduce((total, chunk) => total + chunk.byteLength, 0)
    : data.byteLength;
}

function selectResponseHeaders(headers: Headers): Record<string, string> {
  const selected: Record<string, string> = {};
  headers.forEach((value, name) => {
    const normalized = name.toLowerCase();
    if (responseHeaderSet.has(normalized)) selected[normalized] = value;
  });
  return selected;
}

async function readResponseBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > RELAY_RPC_RESPONSE_BODY_MAX_BYTES) {
      await reader.cancel();
      throw new RelayProtocolError(
        "RPC_RESPONSE_TOO_LARGE",
        `RPC response body exceeds ${RELAY_RPC_RESPONSE_BODY_MAX_BYTES} bytes`,
      );
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function closeWebSocket(socket: WebSocket | undefined): Promise<void> {
  if (!socket || socket.readyState === WebSocket.CLOSED) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      socket.terminate();
      finish();
    }, 500);
    socket.once("close", finish);
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
    else socket.close(1001, "Agent stopping");
  });
}
