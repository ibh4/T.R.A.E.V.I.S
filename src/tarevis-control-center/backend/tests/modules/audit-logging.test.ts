import assert from "node:assert/strict";
import test from "node:test";
import { MockDeviceSource } from "../../src/adapters/mock/mock-device-source.js";
import { MockEventSource } from "../../src/adapters/mock/mock-event-source.js";
import type { AppLogger, LogContext } from "../../src/core/logger.js";
import { CommandsService } from "../../src/modules/commands/commands-service.js";
import { DevicesService } from "../../src/modules/devices/devices-service.js";
import { EventsService } from "../../src/modules/events/events-service.js";

test("audit logs carry stable device, event, request, and command identifiers", async () => {
  const entries: Array<{ message: string; context: LogContext }> = [];
  const write = (message: string, context: LogContext = {}) => entries.push({ message, context });
  const logger: AppLogger = {
    debug: write,
    info: write,
    warn: write,
    error: write,
  };

  const commands = new CommandsService({
    logger,
    createCommandId: () => "cmd_audit_001",
  });
  const created = commands.create({
    requestId: "req_audit_001",
    target: "trae",
    input: "audit task",
    adapterMode: "mock",
  });
  commands.transition(created.command.commandId, "accepted");

  const devices = new DevicesService(new MockDeviceSource(), { logger });
  devices.heartbeat("badge-esp32-01", { metricValue: "90%" });
  const events = new EventsService(new MockEventSource(), { logger });
  events.acknowledge("evt_mock_fall_001", {});

  assert.ok(entries.some(({ context }) => (
    context.requestId === "req_audit_001" && context.commandId === "cmd_audit_001"
  )));
  assert.ok(entries.some(({ context }) => context.deviceId === "badge-esp32-01"));
  assert.ok(entries.some(({ context }) => (
    context.eventId === "evt_mock_fall_001" && context.deviceId === "home-node-rpi4-01"
  )));

  await devices.close();
  await events.close();
  commands.close();
});
