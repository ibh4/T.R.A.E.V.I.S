import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test, { afterEach } from "node:test";
import WebSocket, { WebSocketServer } from "ws";
import { noopLogger } from "../../src/core/logger.js";
import { createEmptySnapshot } from "../../src/core/snapshot-projector.js";
import { RelayAgent } from "../../src/relay/relay-agent.js";
import type { EnabledRelayConfig } from "../../src/relay/relay-config.js";
import { createControlCenterServer } from "../../src/server.js";
import {
  RELAY_PROTOCOL_VERSION,
  serializeRelayMessage,
  type AgentErrorMessage,
  type RelayMessage,
  type RpcRequestMessage,
} from "../../src/relay/relay-protocol.js";

const activeResources: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (activeResources.length > 0) await activeResources.pop()?.();
});

test("backend startup sends hello and forwards initial and subsequent snapshots", async () => {
  const fakeRelay = await FakeRelayServer.create();
  activeResources.push(() => fakeRelay.close());
  const app = createApp(fakeRelay.url);
  activeResources.push(() => app.close());
  const address = await app.start();

  const hello = await fakeRelay.nextMessage((message) => message.type === "agent.hello") as Extract<RelayMessage, { type: "agent.hello" }>;
  assert.equal(hello.deviceId, "my-computer");
  assert.equal(hello.agentVersion, "0.1.0");
  assert.equal(hello.token, TEST_TOKEN);
  const initial = await fakeRelay.nextMessage((message) => message.type === "snapshot") as Extract<RelayMessage, { type: "snapshot" }>;
  assert.equal(initial.schemaVersion, "1.0");
  assert.ok(initial.revision > 0);
  assert.equal(app.relayAgent?.getStatus().cloud, "online");
  assert.equal(app.relayAgent?.getStatus().local, "online");

  const heartbeat = await fetch(`http://127.0.0.1:${address.port}/api/devices/badge-esp32-01/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ metricValue: "91%" }),
  });
  assert.equal(heartbeat.status, 200);
  const updated = await fakeRelay.nextMessage(
    (message) => message.type === "snapshot" && message.revision > initial.revision,
  ) as Extract<RelayMessage, { type: "snapshot" }>;
  assert.equal(updated.snapshot.devices.find((device) => device.deviceId === "badge-esp32-01")?.metricValue, "91%");
});

test("fake Cloudflare RPC calls the local backend and duplicate requestId does not re-execute", async () => {
  const fakeRelay = await FakeRelayServer.create();
  activeResources.push(() => fakeRelay.close());
  const app = createApp(fakeRelay.url);
  activeResources.push(() => app.close());
  const address = await app.start();
  await fakeRelay.nextMessage((message) => message.type === "agent.hello");
  await fakeRelay.nextMessage((message) => message.type === "snapshot");

  const request = rpcRequest("req_relay_reset", "POST", "/api/demo/reset");
  fakeRelay.send(request);
  const first = await fakeRelay.nextMessage(
    (message) => message.type === "rpc.response" && message.requestId === request.requestId,
  ) as Extract<RelayMessage, { type: "rpc.response" }>;
  assert.equal(first.status, 200);
  const firstBody = JSON.parse(first.body) as { revision: number };
  const revisionAfterFirst = app.root.realtimeHub.getRevision();
  assert.equal(firstBody.revision, revisionAfterFirst);

  fakeRelay.send({ ...request, messageId: "msg_duplicate_request", sentAt: "2026-08-06T00:00:01.000Z" });
  const replay = await fakeRelay.nextMessage(
    (message) => message.type === "rpc.response" && message.requestId === request.requestId,
  ) as Extract<RelayMessage, { type: "rpc.response" }>;
  assert.equal(replay.status, 200);
  assert.deepEqual(JSON.parse(replay.body), firstBody);
  assert.equal(app.root.realtimeHub.getRevision(), revisionAfterFirst);

  fakeRelay.send(rpcRequest("req_relay_missing", "GET", "/api/missing"));
  const missing = await fakeRelay.nextMessage(
    (message) => message.type === "rpc.response" && message.requestId === "req_relay_missing",
  ) as Extract<RelayMessage, { type: "rpc.response" }>;
  assert.equal(missing.status, 404);
  assert.equal(JSON.parse(missing.body).error.code, "NOT_FOUND");
  void address;
});

test("cloud disconnect reconnects with backoff and replays the latest snapshot", async () => {
  const fakeRelay = await FakeRelayServer.create();
  activeResources.push(() => fakeRelay.close());
  const app = createApp(fakeRelay.url, { reconnectInitialMs: 20, reconnectMaxMs: 40 });
  activeResources.push(() => app.close());
  await app.start();
  await fakeRelay.nextMessage((message) => message.type === "agent.hello");
  const firstSnapshot = await fakeRelay.nextMessage((message) => message.type === "snapshot");
  const nextHello = fakeRelay.nextMessage((message) => message.type === "agent.hello");
  fakeRelay.closeClients();
  const secondHello = await nextHello;
  assert.notEqual(secondHello.messageId, undefined);
  const replayedSnapshot = await fakeRelay.nextMessage(
    (message) => message.type === "snapshot" && message.revision === firstSnapshot.revision,
  );
  assert.equal(replayedSnapshot.revision, firstSnapshot.revision);
  assert.ok(fakeRelay.connectionCount >= 2);
});

test("invalid handshake responses are rejected and retries are not immediate", async () => {
  for (const behavior of ["reject", "invalid", "timeout"] as const) {
    const fakeRelay = await FakeRelayServer.create({ handshake: behavior });
    activeResources.push(() => fakeRelay.close());
    const agent = new RelayAgent({
      config: testConfig(fakeRelay.url, {
        reconnectInitialMs: 25,
        reconnectMaxMs: 50,
        handshakeTimeoutMs: 25,
        heartbeatMs: 20,
        offlineTimeoutMs: 100,
      }),
      localHttpBaseUrl: "http://127.0.0.1:9",
      localWebSocketUrl: "ws://127.0.0.1:9/ws",
      logger: noopLogger,
    });
    activeResources.push(() => agent.stop());
    agent.start();
    const firstHello = await fakeRelay.nextMessage((message) => message.type === "agent.hello");
    const secondHelloPromise = fakeRelay.nextMessage((message) => message.type === "agent.hello", 2_000);
    const secondHello = await secondHelloPromise;
    assert.equal(secondHello.type, "agent.hello");
    assert.ok(fakeRelay.connectionCount >= 2);
    assert.equal(agent.getStatus().acceptingRpc, false);
    void firstHello;
  }
});

test("local backend timeout returns 504 without retrying the request", async () => {
  const local = await createDelayedHttpServer();
  activeResources.push(() => local.close());
  const fakeRelay = await FakeRelayServer.create();
  activeResources.push(() => fakeRelay.close());
  const agent = new RelayAgent({
    config: testConfig(fakeRelay.url, { reconnectInitialMs: 20, reconnectMaxMs: 40 }),
    localHttpBaseUrl: local.url,
    localWebSocketUrl: "ws://127.0.0.1:9/ws",
    logger: noopLogger,
    rpcTimeoutForPath: () => 30,
  });
  activeResources.push(() => agent.stop());
  agent.start();
  await fakeRelay.nextMessage((message) => message.type === "agent.hello");
  fakeRelay.send(rpcRequest("req_timeout", "POST", "/api/slow", "{}"));
  const response = await fakeRelay.nextMessage(
    (message) => message.type === "rpc.response" && message.requestId === "req_timeout",
  ) as Extract<RelayMessage, { type: "rpc.response" }>;
  assert.equal(response.status, 504);
  assert.equal(JSON.parse(response.body).error.code, "RELAY_TIMEOUT");
});

test("local snapshot websocket reconnects independently and backend close releases resources", async () => {
  const local = await createSnapshotLocalServer();
  activeResources.push(() => local.close());
  const fakeRelay = await FakeRelayServer.create();
  activeResources.push(() => fakeRelay.close());
  const agent = new RelayAgent({
    config: testConfig(fakeRelay.url, { reconnectInitialMs: 20, reconnectMaxMs: 40 }),
    localHttpBaseUrl: "http://127.0.0.1:9",
    localWebSocketUrl: local.url,
    logger: noopLogger,
  });
  agent.start();
  const first = await fakeRelay.nextMessage((message) => message.type === "snapshot");
  const second = await fakeRelay.nextMessage(
    (message) => message.type === "snapshot" && message.revision === first.revision,
  );
  assert.equal(second.revision, first.revision);
  await agent.stop();
  assert.equal(agent.getStatus().cloud, "stopped");
  assert.equal(agent.getStatus().local, "stopped");
  const connectionCount = fakeRelay.connectionCount;
  await delay(100);
  assert.equal(fakeRelay.connectionCount, connectionCount);
});

const TEST_TOKEN = "0123456789abcdef0123456789abcdef";

function createApp(relayUrl: string, overrides: Partial<EnabledRelayConfig> = {}) {
  return createControlCenterServer({
    host: "127.0.0.1",
    port: 0,
    mode: "mock",
    logLevel: "error",
    relay: testConfig(relayUrl, overrides),
  });
}

function testConfig(url: string, overrides: Partial<EnabledRelayConfig> = {}): EnabledRelayConfig {
  return {
    enabled: true,
    url,
    deviceId: "my-computer",
    token: TEST_TOKEN,
    agentVersion: "0.1.0",
    heartbeatMs: 100,
    offlineTimeoutMs: 500,
    reconnectInitialMs: 50,
    reconnectMaxMs: 100,
    handshakeTimeoutMs: 100,
    ...overrides,
  };
}

function rpcRequest(
  requestId: string,
  method: RpcRequestMessage["method"],
  path: string,
  body?: string,
): RpcRequestMessage {
  return {
    type: "rpc.request",
    protocolVersion: RELAY_PROTOCOL_VERSION,
    deviceId: "my-computer",
    messageId: `msg_${requestId}`,
    sentAt: new Date().toISOString(),
    requestId,
    method,
    path,
    headers: {
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body }),
  };
}

class FakeRelayServer {
  private readonly httpServer = createServer();
  private readonly webSocketServer = new WebSocketServer({ noServer: true });
  private readonly clients = new Set<WebSocket>();
  private readonly received: RelayMessage[] = [];
  private readCursor = 0;
  private readonly waiters: Array<{
    predicate: (message: RelayMessage) => boolean;
    resolve: (message: RelayMessage) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private readonly handshake: "accept" | "reject" | "invalid" | "timeout";
  private _port = 0;

  private constructor(options: { handshake?: "accept" | "reject" | "invalid" | "timeout" } = {}) {
    this.handshake = options.handshake ?? "accept";
    this.httpServer.on("upgrade", (request, socket, head) => {
      if (new URL(request.url ?? "/", "http://localhost").pathname !== "/agent/connect") {
        socket.destroy();
        return;
      }
      this.webSocketServer.handleUpgrade(request, socket, head, (client) => {
        this.webSocketServer.emit("connection", client, request);
      });
    });
    this.webSocketServer.on("connection", (socket) => {
      this.clients.add(socket);
      socket.on("close", () => this.clients.delete(socket));
      socket.on("message", (data) => {
        let message: RelayMessage;
        try {
          message = JSON.parse(data.toString()) as RelayMessage;
        } catch {
          return;
        }
        this.received.push(message);
        this.resolveWaiters();
        if (message.type !== "agent.hello") return;
        if (this.handshake === "timeout") return;
        if (this.handshake === "invalid") {
          socket.send(JSON.stringify({
            type: "agent.hello.ok",
            protocolVersion: 2,
            deviceId: message.deviceId,
            messageId: "invalid-version-response",
            sentAt: new Date().toISOString(),
            connectionId: "invalid",
            ackForMessageId: message.messageId,
          }));
          return;
        }
        if (this.handshake === "reject") {
          const error: AgentErrorMessage = {
            type: "agent.error",
            protocolVersion: RELAY_PROTOCOL_VERSION,
            deviceId: message.deviceId,
            messageId: "hello-rejected",
            sentAt: new Date().toISOString(),
            code: "UNAUTHORIZED",
            message: "rejected",
            retryable: false,
          };
          socket.send(serializeRelayMessage(error), () => socket.close(1008, "Handshake rejected"));
          return;
        }
        socket.send(serializeRelayMessage({
          type: "agent.hello.ok",
          protocolVersion: RELAY_PROTOCOL_VERSION,
          deviceId: message.deviceId,
          messageId: "hello-ok",
          sentAt: new Date().toISOString(),
          connectionId: `connection-${this.clients.size}`,
          ackForMessageId: message.messageId,
        }));
      });
    });
  }

  static async create(options: { handshake?: "accept" | "reject" | "invalid" | "timeout" } = {}): Promise<FakeRelayServer> {
    const relay = new FakeRelayServer(options);
    await new Promise<void>((resolve) => relay.httpServer.listen(0, "127.0.0.1", resolve));
    const address = relay.httpServer.address();
    assert.ok(address && typeof address !== "string");
    relay._port = address.port;
    return relay;
  }

  get url(): string {
    return `ws://127.0.0.1:${this._port}/agent/connect`;
  }

  get connectionCount(): number {
    return this.received.filter((message) => message.type === "agent.hello").length;
  }

  send(message: RelayMessage): void {
    const serialized = serializeRelayMessage(message);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(serialized);
    }
  }

  closeClients(): void {
    for (const client of this.clients) client.terminate();
  }

  async nextMessage(predicate: (message: RelayMessage) => boolean, timeoutMs = 3_000): Promise<RelayMessage> {
    for (let index = this.readCursor; index < this.received.length; index += 1) {
      const message = this.received[index];
      if (predicate(message)) {
        this.readCursor = index + 1;
        return message;
      }
    }
    return new Promise<RelayMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error("Timed out waiting for fake relay message"));
      }, timeoutMs);
      this.waiters.push({ predicate, resolve, reject, timer });
    });
  }

  async close(): Promise<void> {
    this.closeClients();
    await new Promise<void>((resolve) => this.webSocketServer.close(() => resolve()));
    if (this.httpServer.listening) {
      await new Promise<void>((resolve, reject) => this.httpServer.close((error) => error ? reject(error) : resolve()));
    }
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("Fake relay closed"));
    }
    this.waiters.length = 0;
  }

  private resolveWaiters(): void {
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index];
      const foundIndex = this.received.findIndex((message, messageIndex) => (
        messageIndex >= this.readCursor && waiter.predicate(message)
      ));
      if (foundIndex < 0) continue;
      clearTimeout(waiter.timer);
      this.waiters.splice(index, 1);
      this.readCursor = foundIndex + 1;
      waiter.resolve(this.received[foundIndex]);
    }
  }
}

async function createDelayedHttpServer(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    if (request.url === "/api/slow") {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      }, 1_000);
      return;
    }
    response.writeHead(404, { "content-type": "application/json" });
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function createSnapshotLocalServer(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer();
  const webSocketServer = new WebSocketServer({ noServer: true });
  let connectionCount = 0;
  server.on("upgrade", (request, socket, head) => {
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      webSocketServer.emit("connection", client, request);
    });
  });
  webSocketServer.on("connection", (socket) => {
    connectionCount += 1;
    socket.send(JSON.stringify({
      type: "snapshot",
      schemaVersion: "1.0",
      revision: 1,
      snapshot: createEmptySnapshot("mock", "online", "2026-08-06T00:00:00.000Z"),
    }));
    if (connectionCount === 1) setTimeout(() => socket.terminate(), 10);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `ws://127.0.0.1:${address.port}/ws`,
    close: async () => {
      for (const client of webSocketServer.clients) client.terminate();
      await new Promise<void>((resolve) => webSocketServer.close(() => resolve()));
      if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
