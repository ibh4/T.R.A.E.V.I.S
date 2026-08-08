import assert from "node:assert/strict";
import test from "node:test";
import { MockEventSource } from "../../src/adapters/mock/mock-event-source.js";
import type { EventReportListener, EventSource } from "../../src/modules/events/event-source.js";
import {
  EventsService,
  InvalidEventTransitionError,
} from "../../src/modules/events/events-service.js";
import {
  parseEventActionInput,
  parseEventReportInput,
  type ControlEvent,
  type EventReportInput,
  type EventState,
} from "../../src/modules/events/events-types.js";

class FakeEventSource implements EventSource {
  readonly adapterMode = "mock" as const;
  listener: EventReportListener | undefined;
  closed = false;

  constructor(private readonly initialEvents: ControlEvent[]) {}

  getInitialEvents(): ControlEvent[] {
    return structuredClone(this.initialEvents);
  }

  start(listener: EventReportListener): void {
    this.listener = listener;
  }

  close(): void {
    this.closed = true;
  }
}

const startTime = Date.parse("2026-08-02T12:00:00.000Z");

function reportInput(
  eventId = "evt_test_fall_001",
  level: EventReportInput["level"] = "critical",
): EventReportInput {
  return {
    schemaVersion: "1.0",
    eventId,
    deviceId: "home-node-rpi4-01",
    source: "vision",
    type: "fall_suspected",
    level,
    zone: "客厅",
    title: "检测到疑似跌倒姿态",
    summary: "测试事件等待确认。",
    confidence: 0.8,
    occurredAt: "2026-08-02T11:59:00.000Z",
    payload: { duration_ms: 8_000 },
  };
}

function eventFixture(state: EventState = "detected", level: ControlEvent["level"] = "critical"): ControlEvent {
  const event: ControlEvent = {
    ...reportInput(`evt_${state}_${level}`, level),
    state,
    updatedAt: "2026-08-02T11:59:00.000Z",
    adapterMode: "mock",
  };
  if (state === "acknowledged" || state === "resolved") {
    event.acknowledgedAt = "2026-08-02T11:59:30.000Z";
    event.acknowledgedBy = "fixture-user";
  }
  if (state === "resolved") {
    event.resolvedAt = "2026-08-02T11:59:45.000Z";
    event.resolvedBy = "fixture-user";
  }
  return event;
}

test("event report and action inputs enforce the frozen runtime contract", () => {
  assert.deepEqual(parseEventReportInput(reportInput()), reportInput());
  assert.deepEqual(parseEventActionInput({}), { actor: "local-demo-user" });
  assert.deepEqual(parseEventActionInput({ actor: "  operator-01  " }), { actor: "operator-01" });
  assert.throws(() => parseEventReportInput({ ...reportInput(), level: "high" }), /level/);
  assert.throws(() => parseEventReportInput({ ...reportInput(), type: "fall_detected" }), /fall_suspected/);
  assert.throws(() => parseEventReportInput({ ...reportInput(), state: "detected" }), /Unknown event field/);
  assert.throws(() => parseEventActionInput({ actor: "" }), /actor/);
});

test("EventsService enforces detected -> acknowledged -> resolved and derives HomeStatus", async () => {
  let nowMs = startTime;
  const source = new FakeEventSource([eventFixture()]);
  const service = new EventsService(source, { now: () => new Date(nowMs) });
  let changes = 0;
  service.subscribe(() => changes += 1);

  assert.equal(service.getHomeStatus().state, "emergency");
  assert.throws(
    () => service.resolve("evt_detected_critical", {}),
    InvalidEventTransitionError,
  );

  nowMs += 1_000;
  const acknowledged = service.acknowledge("evt_detected_critical", { actor: "operator-01" });
  assert.equal(acknowledged.state, "acknowledged");
  assert.equal(acknowledged.acknowledgedBy, "operator-01");
  assert.equal(service.getHomeStatus().state, "attention");
  assert.throws(
    () => service.acknowledge("evt_detected_critical", {}),
    InvalidEventTransitionError,
  );

  nowMs += 1_000;
  const resolved = service.resolve("evt_detected_critical", {});
  assert.equal(resolved.state, "resolved");
  assert.equal(resolved.resolvedBy, "local-demo-user");
  assert.equal(service.getHomeStatus().state, "normal");
  assert.equal(changes, 2);
  await service.close();
  assert.equal(source.closed, true);
});

test("duplicate eventId is idempotent and never overwrites acknowledged state", () => {
  let nowMs = startTime;
  const service = new EventsService(new FakeEventSource([]), { now: () => new Date(nowMs) });
  const first = service.report(reportInput());
  assert.equal(first.created, true);
  service.acknowledge(first.event.eventId, { actor: "operator-01" });

  nowMs += 10_000;
  const duplicate = service.report({
    ...reportInput(),
    title: "A duplicate title that must not win",
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.event.state, "acknowledged");
  assert.equal(duplicate.event.title, "检测到疑似跌倒姿态");
  assert.equal(duplicate.event.acknowledgedBy, "operator-01");
});

test("warning stays attention, info stays normal, and escalated critical can be resolved", () => {
  const warningService = new EventsService(new FakeEventSource([eventFixture("detected", "warning")]));
  assert.equal(warningService.getHomeStatus().state, "attention");

  const infoService = new EventsService(new FakeEventSource([eventFixture("detected", "info")]));
  assert.equal(infoService.getHomeStatus().state, "normal");

  const escalatedService = new EventsService(new FakeEventSource([eventFixture("escalated")]));
  assert.equal(escalatedService.getHomeStatus().state, "emergency");
  assert.equal(escalatedService.resolve("evt_escalated_critical", {}).state, "resolved");
  assert.equal(escalatedService.getHomeStatus().state, "normal");
});

test("MockEventSource presets and triggers fall_suspected events", () => {
  const source = new MockEventSource(() => new Date(startTime));
  const service = new EventsService(source, { now: () => new Date(startTime) });
  assert.equal(service.listEvents().length, 1);
  assert.equal(service.listEvents()[0]?.type, "fall_suspected");
  assert.equal(service.listEvents()[0]?.state, "detected");

  source.triggerFallSuspected({ eventId: "evt_mock_triggered_002" });
  assert.equal(service.listEvents().length, 2);
  assert.equal(service.listEvents().some((event) => event.eventId === "evt_mock_triggered_002"), true);
});
