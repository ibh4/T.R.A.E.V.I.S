import type {
  EventReportListener,
  EventSource,
} from "../../modules/events/event-source.js";
import type {
  ControlEvent,
  EventReportInput,
} from "../../modules/events/events-types.js";

export class MockEventSource implements EventSource {
  readonly adapterMode = "mock" as const;
  private listener: EventReportListener | undefined;

  constructor(private readonly now: () => Date = () => new Date()) {}

  getInitialEvents(): ControlEvent[] {
    const occurredAt = new Date(this.now().getTime() - 120_000).toISOString();
    return [{
      schemaVersion: "1.0",
      eventId: "evt_mock_fall_001",
      deviceId: "home-node-rpi4-01",
      source: "vision",
      type: "fall_suspected",
      level: "critical",
      state: "detected",
      zone: "客厅",
      title: "检测到疑似跌倒姿态",
      summary: "人物姿态在低位持续 8 秒，需要人工确认；当前不能判定为真实跌倒。",
      confidence: 0.82,
      occurredAt,
      updatedAt: occurredAt,
      adapterMode: "mock",
      payload: {
        duration_ms: 8_210,
        person_count: 1,
        evidence: "mock://snapshot/fall-001",
      },
    }];
  }

  start(listener: EventReportListener): void {
    if (this.listener) throw new Error("MockEventSource has already started");
    this.listener = listener;
  }

  triggerFallSuspected(overrides: Partial<EventReportInput> = {}): EventReportInput {
    const occurredAt = this.now().toISOString();
    const input: EventReportInput = {
      schemaVersion: "1.0",
      eventId: `evt_mock_fall_${this.now().getTime()}`,
      deviceId: "home-node-rpi4-01",
      source: "vision",
      type: "fall_suspected",
      level: "critical",
      zone: "客厅",
      title: "检测到疑似跌倒姿态",
      summary: "MockEventSource 触发了一条待确认的疑似跌倒事件。",
      confidence: 0.8,
      occurredAt,
      payload: { trigger: "mock-event-source" },
      ...overrides,
    };
    this.listener?.(input);
    return structuredClone(input);
  }

  close(): void {
    this.listener = undefined;
  }
}
