import assert from "node:assert/strict";
import test from "node:test";
import type {
  ConnectionState,
  ModuleHealth,
} from "../../src/core/contracts.js";
import {
  DiagnosticsService,
  type DiagnosticModuleSource,
} from "../../src/modules/diagnostics/diagnostics-service.js";
import type { DeviceStatus } from "../../src/modules/devices/devices-types.js";
import type { ControlEvent } from "../../src/modules/events/events-types.js";

const device: DeviceStatus = {
  deviceId: "home-node-rpi4-01",
  name: "家庭感知节点 01",
  kind: "home-node",
  zone: "客厅",
  connection: "online",
  detail: "视觉管线运行中",
  lastSeen: "2026-08-03T00:00:00.000Z",
  metricLabel: "VISION FPS",
  metricValue: "4.8",
  adapterMode: "mock",
};

const event: ControlEvent = {
  schemaVersion: "1.0",
  eventId: "evt_diagnostics_001",
  deviceId: device.deviceId,
  source: "vision",
  type: "fall_suspected",
  level: "critical",
  state: "detected",
  zone: "客厅",
  title: "检测到疑似跌倒姿态",
  summary: "等待人工确认。",
  confidence: 0.8,
  occurredAt: "2026-08-03T00:00:00.000Z",
  updatedAt: "2026-08-03T00:00:00.000Z",
  adapterMode: "mock",
  payload: {},
};

function source(
  serviceId: string,
  health: ModuleHealth | undefined,
  connection?: ConnectionState,
): DiagnosticModuleSource {
  return {
    serviceId,
    name: serviceId,
    adapterMode: "mock",
    getHealth: () => health,
    getConnection: () => connection,
  };
}

test("DiagnosticsService aggregates core, modules, adapters, and resource metrics", () => {
  const service = new DiagnosticsService({
    mode: "mock",
    moduleSources: [
      source("devices-module", { connection: "online", detail: "devices healthy" }, "degraded"),
      source("events-module", { connection: "online", detail: "events healthy" }),
      source("trae-adapter", undefined),
      source("robot-adapter", { connection: "online", detail: "robot healthy" }, "online"),
    ],
    getDevices: () => [device],
    getEvents: () => [event],
    sampleRuntime: () => ({
      cpuPercent: 42,
      memoryPercent: 34,
      memoryDisplayValue: "2.7 GB RSS",
    }),
  });

  const slice = service.getSlice();
  assert.deepEqual(slice.services?.map(({ serviceId, connection, adapterMode }) => ({
    serviceId, connection, adapterMode,
  })), [
    { serviceId: "backend-core", connection: "online", adapterMode: "mock" },
    { serviceId: "devices-module", connection: "degraded", adapterMode: "mock" },
    { serviceId: "events-module", connection: "online", adapterMode: "mock" },
    { serviceId: "trae-adapter", connection: "offline", adapterMode: "mock" },
    { serviceId: "robot-adapter", connection: "online", adapterMode: "mock" },
  ]);
  assert.deepEqual(slice.resources?.map(({ id, value, displayValue, tone }) => ({
    id, value, displayValue, tone,
  })), [
    { id: "cpu", value: 42, displayValue: "42.0%", tone: "green" },
    { id: "memory", value: 34, displayValue: "2.7 GB RSS", tone: "green" },
    { id: "vision", value: 60, displayValue: "4.8 FPS", tone: "cyan" },
    { id: "alerts", value: 50, displayValue: "1 CRITICAL", tone: "red" },
  ]);
  assert.equal(slice.resources?.every((metric) => metric.history.length === 7), true);
});

test("one offline module remains isolated and unavailable inputs are explicit", () => {
  const service = new DiagnosticsService({
    mode: "live",
    moduleSources: [
      { ...source("devices-module", undefined), adapterMode: "live" },
      { ...source("events-module", { connection: "online", detail: "events healthy" }), adapterMode: "live" },
      { ...source("trae-adapter", { connection: "online", detail: "trae healthy" }), adapterMode: "live" },
      { ...source("robot-adapter", { connection: "online", detail: "robot healthy" }), adapterMode: "live" },
    ],
    getDevices: () => [],
    getEvents: () => [],
    sampleRuntime: () => ({ cpuPercent: 5, memoryPercent: 10, memoryDisplayValue: "64 MB RSS" }),
  });

  const services = service.getServices();
  assert.equal(services.find((item) => item.serviceId === "devices-module")?.connection, "offline");
  assert.equal(services.filter((item) => item.serviceId !== "devices-module").every(
    (item) => item.connection === "online",
  ), true);
  assert.equal(services.every((item) => item.adapterMode === "live"), true);
  assert.deepEqual(service.getResources().slice(2).map(({ id, displayValue }) => ({ id, displayValue })), [
    { id: "vision", displayValue: "UNAVAILABLE" },
    { id: "alerts", displayValue: "0 ACTIVE" },
  ]);
});

test("resource history follows updated module state without duplicating business data", () => {
  let events = [event];
  const service = new DiagnosticsService({
    mode: "mock",
    moduleSources: [],
    getDevices: () => [device],
    getEvents: () => events,
    sampleRuntime: () => ({ cpuPercent: 10, memoryPercent: 20, memoryDisplayValue: "80 MB RSS" }),
  });

  assert.equal(service.getResources().find((metric) => metric.id === "alerts")?.value, 50);
  events = [{
    ...event,
    state: "resolved",
    resolvedAt: "2026-08-03T00:01:00.000Z",
    resolvedBy: "tester",
    updatedAt: "2026-08-03T00:01:00.000Z",
  }];
  const alerts = service.getResources().find((metric) => metric.id === "alerts");
  assert.equal(alerts?.value, 0);
  assert.equal(alerts?.displayValue, "0 ACTIVE");
  assert.deepEqual(alerts?.history.slice(-2), [50, 0]);
});
