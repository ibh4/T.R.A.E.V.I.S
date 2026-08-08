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

test("heartbeat updates a known device and increments the snapshot revision", async () => {
  const before = await (await fetch(`${baseUrl}/api/state`)).json();
  const response = await fetch(`${baseUrl}/api/devices/microphone-usb-01/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ detail: "Input sampling active", metricValue: "-18 dB" }),
  });
  const body = await response.json();
  const after = await (await fetch(`${baseUrl}/api/state`)).json();

  assert.equal(response.status, 200);
  assert.equal(body.device.connection, "online");
  assert.equal(body.device.detail, "Input sampling active");
  assert.equal(body.device.metricValue, "-18 dB");
  assert.equal(after.revision, before.revision + 1);
  assert.equal(
    after.snapshot.devices.find((device: { deviceId: string }) => device.deviceId === "microphone-usb-01").connection,
    "online",
  );
});

test("heartbeat rejects invalid input and unknown devices with common errors", async () => {
  const invalid = await fetch(`${baseUrl}/api/devices/pc-core-01/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ metricValue: 42 }),
  });
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), {
    error: {
      code: "INVALID_INPUT",
      message: "metricValue must be a non-empty string no longer than 64 characters",
    },
  });

  const missing = await fetch(`${baseUrl}/api/devices/missing-device/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    error: {
      code: "DEVICE_NOT_FOUND",
      message: "Device not found: missing-device",
    },
  });

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
});

test("heartbeat rejects malformed JSON without changing device state", async () => {
  const before = await (await fetch(`${baseUrl}/api/state`)).json();
  const response = await fetch(`${baseUrl}/api/devices/pc-core-01/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  const after = await (await fetch(`${baseUrl}/api/state`)).json();

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, "INVALID_INPUT");
  assert.equal(after.revision, before.revision);
});
