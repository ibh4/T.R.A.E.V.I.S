import assert from "node:assert/strict";
import test from "node:test";
import { MockEventSource } from "../../src/adapters/mock/mock-event-source.js";
import { CommandsService, MAX_COMMAND_HISTORY } from "../../src/modules/commands/commands-service.js";
import { EventsService, MAX_EVENT_HISTORY } from "../../src/modules/events/events-service.js";

test("command and event snapshot lists have hard history limits", () => {
  let commandSequence = 0;
  const commands = new CommandsService({
    createCommandId: () => `cmd_limit_${++commandSequence}`,
  });
  for (let index = 0; index < MAX_COMMAND_HISTORY + 5; index += 1) {
    commands.create({
      requestId: `req_limit_${index}`,
      target: "trae",
      input: `task ${index}`,
      adapterMode: "mock",
    });
  }
  assert.equal(commands.list().length, MAX_COMMAND_HISTORY);
  assert.equal(commands.getSlice().commands?.length, MAX_COMMAND_HISTORY);

  let nowMs = Date.parse("2026-08-03T12:00:00.000Z");
  const events = new EventsService(new MockEventSource(() => new Date(nowMs)), {
    now: () => new Date(nowMs),
  });
  for (let index = 0; index < MAX_EVENT_HISTORY + 5; index += 1) {
    nowMs += 1;
    events.report({
      schemaVersion: "1.0",
      eventId: `evt_limit_${index}`,
      deviceId: "home-node-rpi4-01",
      source: "vision",
      type: "fall_suspected",
      level: "info",
      zone: "测试区",
      title: `事件 ${index}`,
      summary: "历史上限测试。",
      occurredAt: new Date(nowMs).toISOString(),
      payload: {},
    });
  }
  assert.equal(events.listEvents().length, MAX_EVENT_HISTORY);
  assert.equal(events.getSlice().events?.length, MAX_EVENT_HISTORY);
});
