import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { readConfig } from "../src/config.js";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("configuration uses the documented defaults", () => {
  assert.deepEqual(readConfig({}), {
    host: "127.0.0.1",
    port: 8780,
    mode: "mock",
    logLevel: "info",
    traeAdapter: undefined,
    traeCommunicate: {
      url: "http://127.0.0.1:8766",
      timeoutMs: 35_000,
      healthIntervalMs: 5_000,
    },
    harness: {
      projectsFile: resolve(backendRoot, "data", "projects.local.json"),
      defaultProjectPath: resolve(backendRoot, "..", "..", ".."),
      qwen: {
        apiKey: undefined,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        model: "qwen-plus",
        timeoutMs: 120_000,
        maxSteps: 6,
      },
    },
    relay: { enabled: false },
  });
});

test("Relay configuration accepts secure production and loopback development URLs", () => {
  const common = {
    CONTROL_CENTER_RELAY_ENABLED: "true",
    CONTROL_CENTER_DEVICE_ID: "my-computer",
    CONTROL_CENTER_DEVICE_TOKEN: "0123456789abcdef0123456789abcdef",
    CONTROL_CENTER_RELAY_HEARTBEAT_MS: "15000",
    CONTROL_CENTER_RELAY_OFFLINE_TIMEOUT_MS: "45000",
    CONTROL_CENTER_RELAY_RECONNECT_INITIAL_MS: "500",
    CONTROL_CENTER_RELAY_RECONNECT_MAX_MS: "8000",
    CONTROL_CENTER_RELAY_HANDSHAKE_TIMEOUT_MS: "10000",
  };
  const production = readConfig({ ...common, CONTROL_CENTER_RELAY_URL: "wss://api.example.com/agent/connect" });
  assert.deepEqual(production.relay, {
    enabled: true,
    url: "wss://api.example.com/agent/connect",
    deviceId: "my-computer",
    token: common.CONTROL_CENTER_DEVICE_TOKEN,
    agentVersion: "0.1.0",
    heartbeatMs: 15_000,
    offlineTimeoutMs: 45_000,
    reconnectInitialMs: 500,
    reconnectMaxMs: 8_000,
    handshakeTimeoutMs: 10_000,
  });
  assert.equal(readConfig({
    ...common,
    CONTROL_CENTER_RELAY_URL: "ws://127.0.0.1:8787/agent/connect",
  }).relay?.enabled, true);
  const derivedOffline = readConfig({
    ...common,
    CONTROL_CENTER_RELAY_URL: "wss://api.example.com/agent/connect",
    CONTROL_CENTER_RELAY_HEARTBEAT_MS: "60000",
    CONTROL_CENTER_RELAY_OFFLINE_TIMEOUT_MS: undefined,
  });
  assert.equal(derivedOffline.relay?.enabled && derivedOffline.relay.offlineTimeoutMs, 180_000);
});

test("TRAE communicate configuration accepts frozen explicit values", () => {
  const config = readConfig({
    CONTROL_CENTER_TRAE_ADAPTER: "communicate",
    TRAE_COMMUNICATE_URL: "http://127.0.0.1:9876/",
    TRAE_COMMUNICATE_TIMEOUT_MS: "45000",
    TRAE_COMMUNICATE_HEALTH_INTERVAL_MS: "2500",
  });
  assert.equal(config.traeAdapter, "communicate");
  assert.deepEqual(config.traeCommunicate, {
    url: "http://127.0.0.1:9876",
    timeoutMs: 45_000,
    healthIntervalMs: 2_500,
  });
});

test("configuration rejects invalid runtime values", () => {
  assert.throws(() => readConfig({ CONTROL_CENTER_PORT: "70000" }), /Invalid CONTROL_CENTER_PORT/);
  assert.throws(() => readConfig({ CONTROL_CENTER_MODE: "automatic" }), /Invalid CONTROL_CENTER_MODE/);
  assert.throws(() => readConfig({ CONTROL_CENTER_LOG_LEVEL: "verbose" }), /Invalid CONTROL_CENTER_LOG_LEVEL/);
  assert.throws(
    () => readConfig({ CONTROL_CENTER_TRAE_ADAPTER: "automatic" }),
    /Invalid CONTROL_CENTER_TRAE_ADAPTER/,
  );
  for (const url of [
    "https://127.0.0.1:8766",
    "http://localhost:8766",
    "http://127.0.0.1:8766/send",
    "not-a-url",
  ]) {
    assert.throws(() => readConfig({ TRAE_COMMUNICATE_URL: url }), /Invalid TRAE_COMMUNICATE_URL/);
  }
  for (const value of ["999", "120001", "1.5", "later"]) {
    assert.throws(
      () => readConfig({ TRAE_COMMUNICATE_TIMEOUT_MS: value }),
      /Invalid TRAE_COMMUNICATE_TIMEOUT_MS/,
    );
  }
  for (const value of ["999", "60001", "1.5", "later"]) {
    assert.throws(
      () => readConfig({ TRAE_COMMUNICATE_HEALTH_INTERVAL_MS: value }),
      /Invalid TRAE_COMMUNICATE_HEALTH_INTERVAL_MS/,
    );
  }
  assert.throws(() => readConfig({ QWEN_BASE_URL: "ftp://example.com" }), /Invalid QWEN_BASE_URL/);
  assert.throws(() => readConfig({ QWEN_TIMEOUT_MS: "4999" }), /Invalid QWEN_TIMEOUT_MS/);
  assert.throws(() => readConfig({ HARNESS_MAX_STEPS: "13" }), /Invalid HARNESS_MAX_STEPS/);
  assert.throws(() => readConfig({ CONTROL_CENTER_RELAY_ENABLED: "yes" }), /Invalid CONTROL_CENTER_RELAY_ENABLED/);
  const relayBase = {
    CONTROL_CENTER_RELAY_ENABLED: "true",
    CONTROL_CENTER_RELAY_URL: "wss://api.example.com/agent/connect",
    CONTROL_CENTER_DEVICE_ID: "my-computer",
    CONTROL_CENTER_DEVICE_TOKEN: "0123456789abcdef0123456789abcdef",
  };
  assert.throws(
    () => readConfig({ ...relayBase, CONTROL_CENTER_RELAY_URL: "ws://api.example.com/agent/connect" }),
    /Invalid CONTROL_CENTER_RELAY_URL/,
  );
  assert.throws(
    () => readConfig({ ...relayBase, CONTROL_CENTER_RELAY_URL: "wss://api.example.com/other" }),
    /Invalid CONTROL_CENTER_RELAY_URL/,
  );
  assert.throws(() => readConfig({ ...relayBase, CONTROL_CENTER_DEVICE_ID: "bad device" }), /Invalid CONTROL_CENTER_DEVICE_ID/);
  assert.throws(() => readConfig({ ...relayBase, CONTROL_CENTER_DEVICE_TOKEN: "too-short" }), /Invalid CONTROL_CENTER_DEVICE_TOKEN/);
  assert.throws(
    () => readConfig({ ...relayBase, CONTROL_CENTER_RELAY_OFFLINE_TIMEOUT_MS: "20000" }),
    /Invalid CONTROL_CENTER_RELAY_OFFLINE_TIMEOUT_MS/,
  );
  assert.throws(
    () => readConfig({
      ...relayBase,
      CONTROL_CENTER_RELAY_RECONNECT_INITIAL_MS: "9000",
      CONTROL_CENTER_RELAY_RECONNECT_MAX_MS: "8000",
    }),
    /Invalid CONTROL_CENTER_RELAY_RECONNECT_MAX_MS/,
  );
});
