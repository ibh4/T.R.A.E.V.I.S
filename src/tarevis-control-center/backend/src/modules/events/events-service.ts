import type {
  ControlCenterModule,
  HomeStatus,
  ModuleHealth,
  SnapshotSlice,
} from "../../core/contracts.js";
import type { EventSource } from "./event-source.js";
import {
  isControlEvent,
  parseEventActionInput,
  parseEventReportInput,
  MAX_EVENT_HISTORY,
  type ControlEvent,
  type EventState,
} from "./events-types.js";
import { noopLogger, type AppLogger } from "../../core/logger.js";

export { MAX_EVENT_HISTORY } from "./events-types.js";

export class EventNotFoundError extends Error {
  constructor(readonly eventId: string) {
    super(`Event not found: ${eventId}`);
    this.name = "EventNotFoundError";
  }
}

export class InvalidEventTransitionError extends Error {
  constructor(readonly eventId: string, readonly state: EventState, action: string) {
    super(`Cannot ${action} event ${eventId} while it is ${state}`);
    this.name = "InvalidEventTransitionError";
  }
}

export interface ReportEventResult {
  event: ControlEvent;
  created: boolean;
}

export interface EventsServiceOptions {
  now?: () => Date;
  logger?: AppLogger;
}

export class EventsService implements ControlCenterModule {
  readonly moduleId = "events";
  private readonly events = new Map<string, ControlEvent>();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => Date;
  private readonly logger: AppLogger;
  private closed = false;

  constructor(
    private readonly source: EventSource,
    options: EventsServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? noopLogger;
    this.loadInitialEvents();
    source.start((input) => {
      if (!this.closed) this.report(input);
    });
  }

  private loadInitialEvents(): void {
    for (const event of this.source.getInitialEvents()) {
      if (!isControlEvent(event)) throw new Error("Invalid initial event from source");
      if (event.adapterMode !== this.source.adapterMode) {
        throw new Error(`Initial event adapterMode does not match source: ${event.eventId}`);
      }
      if (this.events.has(event.eventId)) {
        throw new Error(`Duplicate eventId from source: ${event.eventId}`);
      }
      this.events.set(event.eventId, structuredClone(event));
    }
  }

  listEvents(): ControlEvent[] {
    return [...this.events.values()]
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
      .slice(0, MAX_EVENT_HISTORY)
      .map((event) => structuredClone(event));
  }

  report(value: unknown): ReportEventResult {
    const input = parseEventReportInput(value);
    const existing = this.events.get(input.eventId);
    if (existing) {
      this.logger.info("event.duplicate", { eventId: input.eventId, deviceId: input.deviceId });
      return { event: structuredClone(existing), created: false };
    }

    const updatedAt = this.now().toISOString();
    const event: ControlEvent = {
      ...input,
      state: "detected",
      updatedAt,
      adapterMode: this.source.adapterMode,
    };
    this.events.set(event.eventId, event);
    this.pruneResolvedHistory();
    this.logger.info("event.reported", { eventId: event.eventId, deviceId: event.deviceId });
    this.emitChanged();
    return { event: structuredClone(event), created: true };
  }

  acknowledge(eventId: string, value: unknown = undefined): ControlEvent {
    const { actor } = parseEventActionInput(value);
    const current = this.requireEvent(eventId);
    if (current.state !== "detected") {
      throw new InvalidEventTransitionError(eventId, current.state, "acknowledge");
    }

    const acknowledgedAt = this.now().toISOString();
    const next: ControlEvent = {
      ...current,
      state: "acknowledged",
      acknowledgedAt,
      acknowledgedBy: actor,
      updatedAt: acknowledgedAt,
    };
    this.events.set(eventId, next);
    this.logger.info("event.acknowledged", { eventId, deviceId: current.deviceId });
    this.emitChanged();
    return structuredClone(next);
  }

  resolve(eventId: string, value: unknown = undefined): ControlEvent {
    const { actor } = parseEventActionInput(value);
    const current = this.requireEvent(eventId);
    if (current.state !== "acknowledged" && current.state !== "escalated") {
      throw new InvalidEventTransitionError(eventId, current.state, "resolve");
    }

    const resolvedAt = this.now().toISOString();
    const next: ControlEvent = {
      ...current,
      state: "resolved",
      resolvedAt,
      resolvedBy: actor,
      updatedAt: resolvedAt,
    };
    this.events.set(eventId, next);
    this.pruneResolvedHistory();
    this.logger.info("event.resolved", { eventId, deviceId: current.deviceId });
    this.emitChanged();
    return structuredClone(next);
  }

  getHomeStatus(): HomeStatus {
    const events = this.listEvents();
    const unresolved = events.filter((event) => event.state !== "resolved");
    const emergency = unresolved.find(
      (event) => event.level === "critical"
        && (event.state === "detected" || event.state === "escalated"),
    );
    if (emergency) {
      return {
        state: "emergency",
        label: emergency.state === "escalated" ? "已升级" : "紧急告警",
        summary: emergency.state === "escalated"
          ? `${emergency.zone}的${emergency.title}已升级，等待处理。`
          : `${emergency.zone}的${emergency.title}等待确认。`,
        activeZone: emergency.zone,
        updatedAt: emergency.updatedAt,
      };
    }

    const attention = unresolved.find(
      (event) => event.level === "critical" || event.level === "warning",
    );
    if (attention) {
      return {
        state: "attention",
        label: "需要关注",
        summary: attention.state === "acknowledged"
          ? `${attention.zone}的${attention.title}已确认，等待解决。`
          : `${attention.zone}的${attention.title}等待处理。`,
        activeZone: attention.zone,
        updatedAt: attention.updatedAt,
      };
    }

    return {
      state: "normal",
      label: "状态正常",
      summary: "当前没有未解决的警告或紧急家庭事件。",
      activeZone: "--",
      updatedAt: events[0]?.updatedAt ?? this.now().toISOString(),
    };
  }

  getSlice(): SnapshotSlice {
    return { events: this.listEvents(), home: this.getHomeStatus() };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getHealth(): ModuleHealth {
    return {
      connection: this.closed ? "offline" : "online",
      detail: this.closed
        ? "EventsModule is closed"
        : `EventsModule registered with ${this.events.size} events from ${this.source.adapterMode} source`,
    };
  }

  async reset(): Promise<void> {
    await this.source.close();
    this.events.clear();
    this.loadInitialEvents();
    this.source.start((input) => {
      if (!this.closed) this.report(input);
    });
    this.logger.info("events.reset");
    this.emitChanged();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    await this.source.close();
  }

  private requireEvent(eventId: string): ControlEvent {
    const event = this.events.get(eventId);
    if (!event) {
      this.logger.warn("event.not_found", { eventId });
      throw new EventNotFoundError(eventId);
    }
    return event;
  }

  private emitChanged(): void {
    for (const listener of this.listeners) listener();
  }

  private pruneResolvedHistory(): void {
    if (this.events.size <= MAX_EVENT_HISTORY) return;
    const removable = [...this.events.values()]
      .filter((event) => event.state === "resolved")
      .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
    while (this.events.size > MAX_EVENT_HISTORY && removable.length > 0) {
      const event = removable.shift();
      if (event) this.events.delete(event.eventId);
    }
  }
}
