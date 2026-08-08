import type { AdapterMode } from "../../core/contracts.js";

export const EVENT_LEVELS = ["info", "warning", "critical"] as const;
export const EVENT_STATES = ["detected", "acknowledged", "resolved", "escalated"] as const;
export const EVENT_SOURCES = ["vision", "audio", "system", "trae", "robot"] as const;
export const EVENT_TYPES = ["fall_suspected"] as const;
export const LOCAL_DEMO_ACTOR = "local-demo-user";
export const MAX_EVENT_HISTORY = 200;

export type EventLevel = typeof EVENT_LEVELS[number];
export type EventState = typeof EVENT_STATES[number];
export type EventSourceName = typeof EVENT_SOURCES[number];
export type EventType = typeof EVENT_TYPES[number];

export interface ControlEvent {
  schemaVersion: "1.0";
  eventId: string;
  deviceId: string;
  source: EventSourceName;
  type: EventType;
  level: EventLevel;
  state: EventState;
  zone: string;
  title: string;
  summary: string;
  confidence?: number;
  occurredAt: string;
  updatedAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  adapterMode: AdapterMode;
  payload: Record<string, unknown>;
}

export interface EventReportInput {
  schemaVersion: "1.0";
  eventId: string;
  deviceId: string;
  source: EventSourceName;
  type: EventType;
  level: EventLevel;
  zone: string;
  title: string;
  summary: string;
  confidence?: number;
  occurredAt: string;
  payload: Record<string, unknown>;
}

export interface EventActionInput {
  actor: string;
}

export class InvalidEventInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEventInputError";
  }
}

const levels = new Set<EventLevel>(EVENT_LEVELS);
const states = new Set<EventState>(EVENT_STATES);
const sources = new Set<EventSourceName>(EVENT_SOURCES);
const types = new Set<EventType>(EVENT_TYPES);
const adapterModes = new Set<AdapterMode>(["mock", "live"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNonEmptyBoundedString(
  record: Record<string, unknown>,
  key: string,
  maximumLength: number,
): boolean {
  return typeof record[key] === "string"
    && Boolean((record[key] as string).trim())
    && (record[key] as string).length <= maximumLength;
}

function readRequiredString(
  record: Record<string, unknown>,
  key: string,
  maximumLength: number,
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim() || value.length > maximumLength) {
    throw new InvalidEventInputError(
      `${key} must be a non-empty string no longer than ${maximumLength} characters`,
    );
  }
  return value.trim();
}

function assertOnlyKeys(record: Record<string, unknown>, allowedKeys: ReadonlySet<string>): void {
  const unknownKey = Object.keys(record).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new InvalidEventInputError(`Unknown event field: ${unknownKey}`);
}

function readIsoDate(record: Record<string, unknown>, key: string): string {
  const value = readRequiredString(record, key, 64);
  if (!Number.isFinite(Date.parse(value))) {
    throw new InvalidEventInputError(`${key} must be a valid ISO date-time string`);
  }
  return value;
}

export function parseEventReportInput(value: unknown): EventReportInput {
  if (!isRecord(value)) {
    throw new InvalidEventInputError("Event body must be a JSON object");
  }
  assertOnlyKeys(value, new Set([
    "schemaVersion", "eventId", "deviceId", "source", "type", "level", "zone",
    "title", "summary", "confidence", "occurredAt", "payload",
  ]));

  if (value.schemaVersion !== "1.0") {
    throw new InvalidEventInputError("schemaVersion must be 1.0");
  }
  const eventId = readRequiredString(value, "eventId", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(eventId)) {
    throw new InvalidEventInputError("eventId contains unsupported characters");
  }
  const source = value.source as EventSourceName;
  const type = value.type as EventType;
  const level = value.level as EventLevel;
  if (!sources.has(source)) throw new InvalidEventInputError("source is not supported");
  if (!types.has(type)) throw new InvalidEventInputError("type must be fall_suspected");
  if (!levels.has(level)) throw new InvalidEventInputError("level must be info, warning, or critical");
  if (!isRecord(value.payload)) {
    throw new InvalidEventInputError("payload must be a JSON object");
  }
  if (value.confidence !== undefined
    && (typeof value.confidence !== "number"
      || !Number.isFinite(value.confidence)
      || value.confidence < 0
      || value.confidence > 1)) {
    throw new InvalidEventInputError("confidence must be a number between 0 and 1");
  }

  const input: EventReportInput = {
    schemaVersion: "1.0",
    eventId,
    deviceId: readRequiredString(value, "deviceId", 128),
    source,
    type,
    level,
    zone: readRequiredString(value, "zone", 128),
    title: readRequiredString(value, "title", 256),
    summary: readRequiredString(value, "summary", 1_024),
    occurredAt: readIsoDate(value, "occurredAt"),
    payload: structuredClone(value.payload),
  };
  if (value.confidence !== undefined) input.confidence = value.confidence;
  return input;
}

export function parseEventActionInput(value: unknown): EventActionInput {
  if (value === undefined) return { actor: LOCAL_DEMO_ACTOR };
  if (!isRecord(value)) {
    throw new InvalidEventInputError("Event action body must be a JSON object");
  }
  assertOnlyKeys(value, new Set(["actor"]));
  return {
    actor: value.actor === undefined
      ? LOCAL_DEMO_ACTOR
      : readRequiredString(value, "actor", 128),
  };
}

function hasValidOptionalDate(record: Record<string, unknown>, key: string): boolean {
  const value = record[key];
  return value === undefined || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function hasValidOptionalString(record: Record<string, unknown>, key: string): boolean {
  return record[key] === undefined || typeof record[key] === "string";
}

export function isControlEvent(value: unknown): value is ControlEvent {
  if (!isRecord(value)) return false;
  const boundedStrings: ReadonlyArray<readonly [string, number]> = [
    ["eventId", 128], ["deviceId", 128], ["zone", 128], ["title", 256],
    ["summary", 1_024], ["occurredAt", 64], ["updatedAt", 64],
  ];
  if (value.schemaVersion !== "1.0"
    || !boundedStrings.every(([key, maximum]) => hasNonEmptyBoundedString(value, key, maximum))
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.eventId as string)
    || !Number.isFinite(Date.parse(value.occurredAt as string))
    || !Number.isFinite(Date.parse(value.updatedAt as string))
    || !sources.has(value.source as EventSourceName)
    || !types.has(value.type as EventType)
    || !levels.has(value.level as EventLevel)
    || !states.has(value.state as EventState)
    || !adapterModes.has(value.adapterMode as AdapterMode)
    || !isRecord(value.payload)
    || (value.confidence !== undefined
      && (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1))
    || !hasValidOptionalDate(value, "acknowledgedAt")
    || !hasValidOptionalDate(value, "resolvedAt")
    || !hasValidOptionalString(value, "acknowledgedBy")
    || !hasValidOptionalString(value, "resolvedBy")) {
    return false;
  }

  if (value.state === "acknowledged") {
    return typeof value.acknowledgedAt === "string"
      && typeof value.acknowledgedBy === "string"
      && value.resolvedAt === undefined
      && value.resolvedBy === undefined;
  }
  if (value.state === "resolved") {
    const hasAcknowledgement = value.acknowledgedAt !== undefined || value.acknowledgedBy !== undefined;
    return typeof value.resolvedAt === "string"
      && typeof value.resolvedBy === "string"
      && (!hasAcknowledgement
        || (typeof value.acknowledgedAt === "string" && typeof value.acknowledgedBy === "string"));
  }
  return value.acknowledgedAt === undefined
    && value.acknowledgedBy === undefined
    && value.resolvedAt === undefined
    && value.resolvedBy === undefined;
}
