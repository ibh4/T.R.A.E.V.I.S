import assert from "node:assert/strict";
import test from "node:test";
import { MockDeviceSource } from "../../src/adapters/mock/mock-device-source.js";
import type {
  DeviceHeartbeatListener,
  DeviceSource,
  IntervalScheduler,
} from "../../src/modules/devices/device-source.js";
import { DevicesService } from "../../src/modules/devices/devices-service.js";
import {
  DEGRADED_AFTER_MS,
  DEVICE_KINDS,
  HEARTBEAT_INTERVAL_MS,
  OFFLINE_AFTER_MS,
  connectionForHeartbeatAge,
  parseDeviceHeartbeatInput,
  type DeviceSeed,
} from "../../src/modules/devices/devices-types.js";

class ManualScheduler implements IntervalScheduler {
  readonly tasks: Array<{ callback: () => void; intervalMs: number; active: boolean }> = [];

  set(callback: () => void, intervalMs: number): unknown {
    const task = { callback, intervalMs, active: true };
    this.tasks.push(task);
    return task;
  }

  clear(handle: unknown): void {
    (handle as ManualScheduler["tasks"][number]).active = false;
  }
}

class FakeDeviceSource implements DeviceSource {
  readonly adapterMode = "mock" as const;
  listener: DeviceHeartbeatListener | undefined;
  closed = false;

  constructor(private readonly seeds: DeviceSeed[]) {}

  getInitialDevices(): DeviceSeed[] {
    return structuredClone(this.seeds);
  }

  start(listener: DeviceHeartbeatListener): void {
    this.listener = listener;
  }

  emit(deviceId: string): void {
    this.listener?.(deviceId, {});
  }

  close(): void {
    this.closed = true;
  }
}

const startTime = Date.parse("2026-08-02T12:00:00.000Z");

function seed(lastSeen = new Date(startTime).toISOString()): DeviceSeed {
  return {
    deviceId: "device-01",
    name: "Test Device",
    kind: "pc",
    zone: "Test Lab",
    detail: "Test fixture",
    lastSeen,
    metricLabel: "LOAD",
    metricValue: "10%",
  };
}

test("heartbeat input validation accepts only bounded device fields", () => {
  assert.deepEqual(parseDeviceHeartbeatInput({}), {});
  assert.deepEqual(
    parseDeviceHeartbeatInput({ detail: "  healthy  ", metricValue: "42%" }),
    { detail: "healthy", metricValue: "42%" },
  );
  assert.throws(() => parseDeviceHeartbeatInput([]), /JSON object/);
  assert.throws(() => parseDeviceHeartbeatInput({ metricValue: 42 }), /metricValue/);
  assert.throws(() => parseDeviceHeartbeatInput({ observedAt: "2026-08-02" }), /Unknown heartbeat field/);
});

test("connection thresholds switch at exactly 15 and 45 seconds", () => {
  assert.equal(connectionForHeartbeatAge(DEGRADED_AFTER_MS - 1), "online");
  assert.equal(connectionForHeartbeatAge(DEGRADED_AFTER_MS), "degraded");
  assert.equal(connectionForHeartbeatAge(OFFLINE_AFTER_MS - 1), "degraded");
  assert.equal(connectionForHeartbeatAge(OFFLINE_AFTER_MS), "offline");
});

test("MockDeviceSource covers every UI kind and emits five-second heartbeats", () => {
  const scheduler = new ManualScheduler();
  const source = new MockDeviceSource(() => new Date(startTime), scheduler);
  const devices = source.getInitialDevices();
  const heartbeats: string[] = [];

  assert.equal(devices.length, 6);
  assert.deepEqual(new Set(devices.map((device) => device.kind)), new Set(DEVICE_KINDS));
  source.start((deviceId) => heartbeats.push(deviceId));
  assert.equal(scheduler.tasks[0]?.intervalMs, HEARTBEAT_INTERVAL_MS);
  scheduler.tasks[0]?.callback();
  assert.deepEqual(heartbeats, [
    "pc-core-01",
    "home-node-rpi4-01",
    "camera-ov5647-01",
    "robot-spider-01",
  ]);
  source.close();
  assert.equal(scheduler.tasks[0]?.active, false);
});

test("DevicesService emits changes across thresholds and returns to online on heartbeat", async () => {
  let nowMs = startTime;
  const scheduler = new ManualScheduler();
  const source = new FakeDeviceSource([seed()]);
  const service = new DevicesService(source, {
    now: () => new Date(nowMs),
    scheduler,
  });
  let changes = 0;
  service.subscribe(() => changes += 1);

  nowMs = startTime + DEGRADED_AFTER_MS - 1;
  assert.equal(service.refreshConnectionStates(), false);
  assert.equal(service.listDevices()[0]?.connection, "online");

  nowMs = startTime + DEGRADED_AFTER_MS;
  assert.equal(service.refreshConnectionStates(), true);
  assert.equal(service.listDevices()[0]?.connection, "degraded");

  nowMs = startTime + OFFLINE_AFTER_MS;
  assert.equal(service.refreshConnectionStates(), true);
  assert.equal(service.listDevices()[0]?.connection, "offline");

  nowMs = startTime + 50_000;
  const heartbeat = service.heartbeat("device-01", {
    detail: "Recovered",
    metricValue: "11%",
  });
  assert.equal(heartbeat.connection, "online");
  assert.equal(heartbeat.lastSeen, "2026-08-02T12:00:50.000Z");
  assert.equal(heartbeat.detail, "Recovered");
  assert.equal(heartbeat.metricValue, "11%");
  assert.equal(heartbeat.adapterMode, "mock");
  assert.equal(changes, 3);

  const copy = service.listDevices();
  copy[0]!.detail = "Mutated copy";
  assert.equal(service.listDevices()[0]?.detail, "Recovered");
  await service.close();
  assert.equal(source.closed, true);
});
