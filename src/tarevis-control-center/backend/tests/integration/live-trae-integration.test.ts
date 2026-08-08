import assert from "node:assert/strict";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import test from "node:test";
import WebSocket from "ws";
import type { AppConfig, RuntimeMode } from "../../src/config.js";
import type { SnapshotMessage } from "../../src/core/contracts.js";
import { createControlCenterServer } from "../../src/server.js";

type Readiness = "online" | "degraded" | "offline";
type SendOutcome = "success" | "failed";

class FakeTraeBridge {
  private readonly server: Server;
  private port = 0;
  readiness: Readiness = "online";
  sendOutcome: SendOutcome = "success";
  readonly requestIds: string[] = [];

  constructor() {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", reject);
        const address = this.server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Fake Bridge did not expose a TCP port"));
          return;
        }
        this.port = address.port;
        resolve();
      });
    });
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async close(): Promise<void> {
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
  }

  private async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    if (request.method === "GET" && request.url === "/ready") {
      if (this.readiness === "offline") {
        request.socket.destroy();
        return;
      }
      this.sendJson(response, this.readiness === "online" ? 200 : 503, {
        success: this.readiness === "online",
        ready: this.readiness === "online",
        reason: this.readiness === "online" ? undefined : "TRAE window unavailable",
      });
      return;
    }
    if (request.method === "POST" && request.url === "/send") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        requestId: string;
        text: string;
      };
      this.requestIds.push(body.requestId);
      const sent = this.sendOutcome === "success";
      this.sendJson(response, sent ? 200 : 503, {
        success: sent,
        requestId: body.requestId,
        sent,
        strategy: "fake",
        message: sent ? "prompt sent" : "TRAE disconnected before delivery",
        response: sent
          ? { status: "read", text: `reply:${body.text}` }
          : { status: "skipped", reason: "not sent" },
        sentAt: new Date().toISOString(),
        ...(sent ? {} : {
          error: { code: "TRAE_UNAVAILABLE", message: "TRAE disconnected before delivery" },
        }),
      });
      return;
    }
    this.sendJson(response, 404, { success: false });
  }

  private sendJson(
    response: ServerResponse,
    status: number,
    body: unknown,
  ): void {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  }
}

function communicateConfig(bridge: FakeTraeBridge, mode: RuntimeMode): AppConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    mode,
    logLevel: "error",
    traeAdapter: "communicate",
    traeCommunicate: {
      url: bridge.url,
      timeoutMs: 1_000,
      healthIntervalMs: 1_000,
    },
  };
}

async function waitFor<T>(read: () => T | Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 4_000;
  let value = await read();
  while (!accept(value)) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for integration state");
    await new Promise((resolve) => setTimeout(resolve, 20));
    value = await read();
  }
  return value;
}

async function readState(baseUrl: string): Promise<any> {
  return (await fetch(`${baseUrl}/api/state`)).json();
}

async function readHealth(baseUrl: string): Promise<any> {
  return (await fetch(`${baseUrl}/api/health`)).json();
}

async function postCommand(baseUrl: string, requestId: string, input: string): Promise<Response> {
  return fetch(`${baseUrl}/api/trae/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId, input }),
  });
}

function waitForSocketCommand(
  socket: WebSocket,
  requestId: string,
  status: string,
): Promise<SnapshotMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${requestId}`)), 4_000);
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as SnapshotMessage;
      const command = message.snapshot.commands.find((candidate) => candidate.requestId === requestId);
      if (command?.status !== status) return;
      clearTimeout(timeout);
      socket.off("message", onMessage);
      resolve(message);
    };
    socket.on("message", onMessage);
    socket.once("error", reject);
  });
}

async function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

test("hybrid communicate mode keeps other adapters mock and synchronizes the live lifecycle", async () => {
  const bridge = new FakeTraeBridge();
  await bridge.start();
  const app = createControlCenterServer(communicateConfig(bridge, "hybrid"));
  const address = await app.start();
  const baseUrl = `http://${address.host}:${address.port}`;
  const wsUrl = `ws://${address.host}:${address.port}/ws`;
  let firstSocket: WebSocket | undefined;
  let secondSocket: WebSocket | undefined;
  try {
    await waitFor(() => readHealth(baseUrl), (health) => health.modules.trae.connection === "online");
    const initial = await readState(baseUrl);
    assert.equal(initial.schemaVersion, "1.0");
    assert.equal(initial.snapshot.mode, "hybrid");
    assert.equal(initial.snapshot.devices.every((device: any) => device.adapterMode === "mock"), true);
    assert.equal(initial.snapshot.events.every((event: any) => event.adapterMode === "mock"), true);
    assert.equal(initial.snapshot.robot.connection, "online");
    const services = Object.fromEntries(initial.snapshot.services.map((service: any) => [service.serviceId, service]));
    assert.equal(services["trae-adapter"].adapterMode, "live");
    assert.equal(services["trae-adapter"].connection, "online");
    assert.equal(services["devices-module"].adapterMode, "mock");
    assert.equal(services["events-module"].adapterMode, "mock");
    assert.equal(services["robot-adapter"].adapterMode, "mock");

    const beforeRevision = initial.revision;
    const firstResponse = await postCommand(baseUrl, "req_hybrid_live", "hybrid command");
    const firstBody = await firstResponse.json();
    assert.equal(firstResponse.status, 202);
    assert.equal(firstBody.command.adapterMode, "live");
    const completed = await waitFor(
      () => readState(baseUrl),
      (state) => state.snapshot.commands.some(
        (command: any) => command.requestId === "req_hybrid_live" && command.status === "succeeded",
      ),
    );
    assert.equal(completed.revision, beforeRevision + 4);
    assert.equal(bridge.requestIds.filter((id) => id === "req_hybrid_live").length, 1);

    const duplicate = await postCommand(baseUrl, "req_hybrid_live", "ignored duplicate text");
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).created, false);
    assert.equal(bridge.requestIds.filter((id) => id === "req_hybrid_live").length, 1);

    firstSocket = await openSocket(wsUrl);
    secondSocket = await openSocket(wsUrl);
    const firstTerminal = waitForSocketCommand(firstSocket, "req_ws_live", "succeeded");
    const secondTerminal = waitForSocketCommand(secondSocket, "req_ws_live", "succeeded");
    const socketCommand = await postCommand(baseUrl, "req_ws_live", "websocket command");
    assert.equal(socketCommand.status, 202);
    const [firstMessage, secondMessage] = await Promise.all([firstTerminal, secondTerminal]);
    assert.deepEqual(secondMessage, firstMessage);

    const revisionBeforeReset = firstMessage.revision;
    const resetResponse = await fetch(`${baseUrl}/api/demo/reset`, { method: "POST" });
    const reset = await resetResponse.json();
    assert.equal(resetResponse.status, 200);
    assert.equal(reset.revision, revisionBeforeReset + 1);
    assert.deepEqual(reset.snapshot.commands, []);
    assert.equal(reset.snapshot.trae.state, "idle");
  } finally {
    firstSocket?.close();
    secondSocket?.close();
    await app.close();
    await bridge.close();
  }
});

test("live communicate mode enables only TRAE while unavailable states recover without restart", async () => {
  const bridge = new FakeTraeBridge();
  bridge.readiness = "degraded";
  await bridge.start();
  const app = createControlCenterServer(communicateConfig(bridge, "live"));
  const address = await app.start();
  const baseUrl = `http://${address.host}:${address.port}`;
  try {
    const degraded = await waitFor(
      () => readState(baseUrl),
      (state) => state.snapshot.services.some(
        (service: any) => service.serviceId === "trae-adapter" && service.connection === "degraded",
      ),
    );
    assert.deepEqual(degraded.snapshot.devices, []);
    assert.deepEqual(degraded.snapshot.events, []);
    assert.equal(degraded.snapshot.robot.state, "offline");
    assert.equal(degraded.snapshot.services.every((service: any) => service.adapterMode === "live"), true);
    assert.equal(degraded.snapshot.trae.state, "offline");

    const unavailable = await postCommand(baseUrl, "req_degraded", "blocked while degraded");
    assert.equal(unavailable.status, 503);
    assert.equal((await unavailable.json()).error.code, "MODULE_UNAVAILABLE");
    assert.deepEqual((await readState(baseUrl)).snapshot.commands, []);

    bridge.readiness = "offline";
    await waitFor(() => readHealth(baseUrl), (health) => health.modules.trae.connection === "offline");
    const offline = await postCommand(baseUrl, "req_offline", "blocked while offline");
    assert.equal(offline.status, 503);

    bridge.readiness = "online";
    await waitFor(() => readHealth(baseUrl), (health) => health.modules.trae.connection === "online");
    const recovered = await postCommand(baseUrl, "req_recovered", "accepted after recovery");
    assert.equal(recovered.status, 202);
    await waitFor(
      () => readState(baseUrl),
      (state) => state.snapshot.commands.some(
        (command: any) => command.requestId === "req_recovered" && command.status === "succeeded",
      ),
    );

    bridge.sendOutcome = "failed";
    const raced = await postCommand(baseUrl, "req_disconnect_race", "disconnect during send");
    assert.equal(raced.status, 202);
    await waitFor(
      () => readState(baseUrl),
      (state) => state.snapshot.commands.some(
        (command: any) => command.requestId === "req_disconnect_race" && command.status === "failed",
      ),
    );
    const callsBeforeDuplicate = bridge.requestIds.length;
    const duplicate = await postCommand(baseUrl, "req_disconnect_race", "must not resend");
    assert.equal(duplicate.status, 200);
    assert.equal((await duplicate.json()).created, false);
    assert.equal(bridge.requestIds.length, callsBeforeDuplicate);
  } finally {
    await app.close();
    await bridge.close();
  }
});
