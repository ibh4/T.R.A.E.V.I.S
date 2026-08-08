import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { createControlCenterServer, type ControlCenterServer } from "../../src/server.js";

let app: ControlCenterServer;
let baseUrl: string;

beforeEach(async () => {
  app = createControlCenterServer({
    host: "127.0.0.1",
    port: 0,
    mode: "mock",
    logLevel: "error",
  });
  const address = await app.start();
  baseUrl = `http://${address.host}:${address.port}`;
});

afterEach(async () => {
  await app.close();
});

async function post(pathname: string, body: unknown = {}): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function reportBody(eventId = "evt_api_fall_001") {
  return {
    schemaVersion: "1.0",
    eventId,
    deviceId: "home-node-rpi4-01",
    source: "vision",
    type: "fall_suspected",
    level: "critical",
    zone: "客厅",
    title: "API 上报的疑似跌倒",
    summary: "用于验证事件上报接口。",
    confidence: 0.86,
    occurredAt: "2026-08-02T12:00:00.000Z",
    payload: { test: true },
  };
}

test("event API validates input and returns 404 and 409 common errors", async () => {
  const invalid = await post("/api/events", { ...reportBody(), level: "high" });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "INVALID_INPUT");

  const invalidAck = await post("/api/events/evt_mock_fall_001/ack", { actor: 42 });
  assert.equal(invalidAck.status, 400);
  assert.equal((await invalidAck.json()).error.code, "INVALID_INPUT");

  const invalidResolve = await post("/api/events/evt_mock_fall_001/resolve", { actor: 42 });
  assert.equal(invalidResolve.status, 400);
  assert.equal((await invalidResolve.json()).error.code, "INVALID_INPUT");

  const missing = await post("/api/events/missing-event/ack");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "EVENT_NOT_FOUND");

  const illegalResolve = await post("/api/events/evt_mock_fall_001/resolve");
  assert.equal(illegalResolve.status, 409);
  assert.deepEqual(await illegalResolve.json(), {
    error: {
      code: "INVALID_STATE_TRANSITION",
      message: "Cannot resolve event evt_mock_fall_001 while it is detected",
    },
  });
});

test("acknowledge keeps Home attention until resolve restores normal", async () => {
  const before = await (await fetch(`${baseUrl}/api/state`)).json();
  assert.equal(before.snapshot.home.state, "emergency");

  const acknowledged = await post("/api/events/evt_mock_fall_001/ack", { actor: "operator-01" });
  assert.equal(acknowledged.status, 200);
  assert.equal((await acknowledged.json()).event.state, "acknowledged");
  const afterAck = await (await fetch(`${baseUrl}/api/state`)).json();
  assert.equal(afterAck.revision, before.revision + 1);
  assert.equal(afterAck.snapshot.home.state, "attention");
  assert.equal(afterAck.snapshot.events[0].acknowledgedBy, "operator-01");

  const duplicateAck = await post("/api/events/evt_mock_fall_001/ack");
  assert.equal(duplicateAck.status, 409);

  const resolved = await post("/api/events/evt_mock_fall_001/resolve");
  assert.equal(resolved.status, 200);
  assert.equal((await resolved.json()).event.state, "resolved");
  const afterResolve = await (await fetch(`${baseUrl}/api/state`)).json();
  assert.equal(afterResolve.revision, afterAck.revision + 1);
  assert.equal(afterResolve.snapshot.home.state, "normal");
  assert.equal(afterResolve.snapshot.events[0].resolvedBy, "local-demo-user");
});

test("event reports are idempotent and preserve server-owned state", async () => {
  const created = await post("/api/events", reportBody());
  assert.equal(created.status, 201);
  assert.equal((await created.json()).created, true);

  await post("/api/events/evt_api_fall_001/ack");
  const duplicate = await post("/api/events", {
    ...reportBody(),
    title: "duplicate must not overwrite state",
  });
  assert.equal(duplicate.status, 200);
  const duplicateBody = await duplicate.json();
  assert.equal(duplicateBody.created, false);
  assert.equal(duplicateBody.event.state, "acknowledged");
  assert.equal(duplicateBody.event.title, "API 上报的疑似跌倒");
});
