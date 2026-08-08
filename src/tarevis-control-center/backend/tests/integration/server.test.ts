import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import WebSocket from "ws";
import { createControlCenterServer, type ControlCenterServer } from "../../src/server.js";
import type { SnapshotMessage } from "../../src/core/contracts.js";

let app: ControlCenterServer;
let baseUrl: string;
let wsUrl: string;

beforeEach(async () => {
  app = createControlCenterServer({
    host: "127.0.0.1",
    port: 0,
    mode: "mock",
    logLevel: "error",
  });
  const address = await app.start();
  baseUrl = `http://${address.host}:${address.port}`;
  wsUrl = `ws://${address.host}:${address.port}/ws`;
});

afterEach(async () => {
  await app.close();
});

test("health and state expose registered module snapshots", async () => {
  const healthResponse = await fetch(`${baseUrl}/api/health`);
  const health = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(health.ok, true);
  assert.equal(health.mode, "mock");
  assert.equal(health.revision, 7);
  assert.equal(health.modules.devices.connection, "online");
  assert.match(health.modules.devices.detail, /6 devices from mock source/);
  assert.equal(health.modules.events.connection, "online");
  assert.match(health.modules.events.detail, /1 events from mock source/);
  assert.equal(health.modules.commands.connection, "online");
  assert.equal(health.modules.trae.connection, "online");
  assert.equal(health.modules.robot.connection, "online");
  assert.equal(health.modules.diagnostics.connection, "online");

  const stateResponse = await fetch(`${baseUrl}/api/state`);
  const state = await stateResponse.json();
  assert.equal(stateResponse.status, 200);
  assert.equal(state.schemaVersion, "1.0");
  assert.equal(state.revision, 7);
  assert.equal(state.snapshot.connection, "online");
  assert.equal(state.snapshot.home.state, "emergency");
  assert.equal(state.snapshot.trae.state, "idle");
  assert.equal(state.snapshot.robot.state, "standby");
  assert.equal(state.snapshot.robot.connection, "online");
  assert.equal(state.snapshot.devices.length, 6);
  assert.deepEqual(
    state.snapshot.devices.map((device: { connection: string }) => device.connection),
    ["online", "online", "online", "degraded", "offline", "online"],
  );
  assert.equal(state.snapshot.devices.every((device: { adapterMode: string }) => device.adapterMode === "mock"), true);
  assert.equal(state.snapshot.events.length, 1);
  assert.equal(state.snapshot.events[0].state, "detected");
  assert.equal(state.snapshot.events[0].adapterMode, "mock");
  assert.deepEqual(state.snapshot.commands, []);
  assert.equal(state.snapshot.services.length, 5);
  assert.equal(state.snapshot.services.every((service: { adapterMode: string }) => service.adapterMode === "mock"), true);
  assert.deepEqual(
    state.snapshot.resources.map((resource: { id: string }) => resource.id),
    ["cpu", "memory", "vision", "alerts"],
  );
  assert.equal(state.snapshot.resources.find((resource: { id: string }) => resource.id === "vision").displayValue, "4.8 FPS");
  assert.equal(state.snapshot.resources.find((resource: { id: string }) => resource.id === "alerts").displayValue, "1 CRITICAL");
});

test("unknown HTTP routes use the common error envelope", async () => {
  const response = await fetch(`${baseUrl}/api/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: {
      code: "NOT_FOUND",
      message: "No route for GET /api/missing",
    },
  });
});

test("websocket sends the initial devices then a newer heartbeat snapshot", async () => {
  const socket = new WebSocket(wsUrl);
  const messages: SnapshotMessage[] = [];

  const twoMessages = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for websocket snapshots")), 2_000);
    socket.on("message", (data) => {
      messages.push(JSON.parse(data.toString()) as SnapshotMessage);
      if (messages.length === 1) {
        void fetch(`${baseUrl}/api/devices/badge-esp32-01/heartbeat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ metricValue: "90%" }),
        }).catch(reject);
      }
      if (messages.length === 2) {
        clearTimeout(timeout);
        resolve();
      }
    });
    socket.on("error", reject);
  });

  await twoMessages;
  socket.close();

  assert.equal(messages[0]?.type, "snapshot");
  assert.equal(messages[0]?.schemaVersion, "1.0");
  assert.equal(messages[0]?.revision, 7);
  assert.equal(messages[1]?.revision, 8);
  assert.equal(messages[1]?.snapshot.home.state, "emergency");
  const badge = messages[1]?.snapshot.devices.find((device) => device.deviceId === "badge-esp32-01");
  assert.equal(badge?.connection, "online");
  assert.equal(badge?.metricValue, "90%");
});

test("live mode remains unavailable instead of silently using MockDeviceSource", async () => {
  const liveApp = createControlCenterServer({
    host: "127.0.0.1",
    port: 0,
    mode: "live",
    logLevel: "error",
  });
  const address = await liveApp.start();
  const liveBaseUrl = `http://${address.host}:${address.port}`;
  try {
    const state = await (await fetch(`${liveBaseUrl}/api/state`)).json();
    assert.equal(state.snapshot.mode, "live");
    assert.deepEqual(state.snapshot.devices, []);
    assert.deepEqual(state.snapshot.events, []);
    assert.deepEqual(state.snapshot.commands, []);
    assert.equal(state.snapshot.trae.state, "offline");
    assert.equal(state.snapshot.robot.state, "offline");
    assert.equal(state.snapshot.services.find((service: { serviceId: string }) => service.serviceId === "backend-core").connection, "online");
    assert.equal(state.snapshot.services.filter((service: { serviceId: string }) => service.serviceId !== "backend-core").every(
      (service: { connection: string; adapterMode: string }) => service.connection === "offline" && service.adapterMode === "live",
    ), true);
    assert.equal(state.snapshot.resources.find((resource: { id: string }) => resource.id === "vision").displayValue, "UNAVAILABLE");

    const heartbeat = await fetch(`${liveBaseUrl}/api/devices/pc-core-01/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(heartbeat.status, 503);
    assert.deepEqual(await heartbeat.json(), {
      error: {
        code: "MODULE_UNAVAILABLE",
        message: "DevicesModule has no live adapter and is unavailable in live mode",
      },
    });

    const event = await fetch(`${liveBaseUrl}/api/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(event.status, 503);
    assert.deepEqual(await event.json(), {
      error: {
        code: "MODULE_UNAVAILABLE",
        message: "EventsModule has no live adapter and is unavailable in live mode",
      },
    });

    const command = await fetch(`${liveBaseUrl}/api/trae/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId: "req_live", input: "test" }),
    });
    assert.equal(command.status, 503);
    assert.equal((await command.json()).error.code, "MODULE_UNAVAILABLE");
    const commands = await fetch(`${liveBaseUrl}/api/commands?target=trae`);
    assert.equal(commands.status, 200);
    assert.deepEqual((await commands.json()).commands, []);

    const robot = await fetch(`${liveBaseUrl}/api/robot/commands`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "req_live_robot",
        action: "forward",
        params: { distanceCm: 30 },
        confirmed: true,
      }),
    });
    assert.equal(robot.status, 503);
    assert.equal((await robot.json()).error.code, "MODULE_UNAVAILABLE");
  } finally {
    await liveApp.close();
  }
});

test("demo reset publishes one revision and invalidates pending Mock callbacks", async () => {
  const socket = new WebSocket(wsUrl);
  const revisions: number[] = [];
  await new Promise<void>((resolve, reject) => {
    socket.once("message", (data) => {
      revisions.push((JSON.parse(data.toString()) as SnapshotMessage).revision);
      resolve();
    });
    socket.once("error", reject);
  });

  await fetch(`${baseUrl}/api/trae/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: "req_reset_trae", input: "reset race" }),
  });
  await fetch(`${baseUrl}/api/robot/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "req_reset_robot",
      action: "patrol",
      params: {},
      confirmed: true,
    }),
  });
  const beforeReset = await (await fetch(`${baseUrl}/api/state`)).json();
  assert.equal(beforeReset.snapshot.commands.length, 2);

  socket.on("message", (data) => revisions.push((JSON.parse(data.toString()) as SnapshotMessage).revision));
  const resetResponse = await fetch(`${baseUrl}/api/demo/reset`, { method: "POST" });
  const reset = await resetResponse.json();
  assert.equal(resetResponse.status, 200);
  assert.equal(reset.revision, beforeReset.revision + 1);
  assert.deepEqual(reset.snapshot.commands, []);
  assert.equal(reset.snapshot.events.length, 1);
  assert.equal(reset.snapshot.events[0].state, "detected");
  assert.equal(reset.snapshot.trae.state, "idle");
  assert.equal(reset.snapshot.robot.state, "standby");

  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const afterCallbacks = await (await fetch(`${baseUrl}/api/state`)).json();
  assert.equal(afterCallbacks.revision, reset.revision);
  assert.deepEqual(afterCallbacks.snapshot.commands, []);
  assert.deepEqual(revisions.filter((revision) => revision > beforeReset.revision), [reset.revision]);
  socket.close();
});

test("concurrent reset callers share one atomic operation", async () => {
  const beforeRevision = app.root.realtimeHub.getRevision();
  const first = app.root.resetDemo();
  const second = app.root.resetDemo();
  assert.equal(first, second);
  const [firstEnvelope, secondEnvelope] = await Promise.all([first, second]);
  assert.equal(firstEnvelope.revision, beforeRevision + 1);
  assert.equal(secondEnvelope.revision, firstEnvelope.revision);
});

test("cross-target requestId reuse returns a 409 common error", async () => {
  const robot = await fetch(`${baseUrl}/api/robot/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId: "req_cross_target",
      action: "stop",
      params: {},
      confirmed: false,
    }),
  });
  assert.equal(robot.status, 202);

  const trae = await fetch(`${baseUrl}/api/trae/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: "req_cross_target", input: "must conflict" }),
  });
  assert.equal(trae.status, 409);
  assert.equal((await trae.json()).error.code, "REQUEST_ID_CONFLICT");
});

test("one module projection failure degrades the snapshot without stopping other modules", async () => {
  const events = app.root.events;
  assert.ok(events);
  const originalGetSlice = events.getSlice.bind(events);
  events.getSlice = () => {
    throw new Error("simulated module failure");
  };
  app.root.notifyCoreChanged();

  const response = await fetch(`${baseUrl}/api/state`);
  const state = await response.json();
  assert.equal(response.status, 200);
  assert.equal(state.snapshot.connection, "degraded");
  assert.equal(state.snapshot.home.state, "unavailable");
  assert.deepEqual(state.snapshot.events, []);
  assert.equal(state.snapshot.devices.length, 6);
  assert.equal(state.snapshot.trae.state, "idle");
  assert.equal(state.snapshot.robot.state, "standby");

  events.getSlice = originalGetSlice;
  app.root.notifyCoreChanged();
  const recovered = await (await fetch(`${baseUrl}/api/state`)).json();
  assert.equal(recovered.snapshot.connection, "online");
  assert.equal(recovered.snapshot.events.length, 1);
});

test("hybrid mode remains globally visible while each active adapter stays explicit", async () => {
  const hybridApp = createControlCenterServer({
    host: "127.0.0.1",
    port: 0,
    mode: "hybrid",
    logLevel: "error",
  });
  const address = await hybridApp.start();
  try {
    const state = await (await fetch(`http://${address.host}:${address.port}/api/state`)).json();
    assert.equal(state.snapshot.mode, "hybrid");
    assert.equal(state.snapshot.services.every(
      (service: { adapterMode: string }) => service.adapterMode === "mock",
    ), true);
    assert.equal(state.snapshot.devices.every(
      (device: { adapterMode: string }) => device.adapterMode === "mock",
    ), true);
    assert.equal(state.snapshot.trae.state, "idle");
    assert.equal(state.snapshot.robot.connection, "online");
  } finally {
    await hybridApp.close();
  }
});
