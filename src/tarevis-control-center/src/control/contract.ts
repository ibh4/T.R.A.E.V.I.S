import type {
  CommandRecord,
  ConnectionState,
  ControlCenterSnapshot,
  ControlEvent,
  DeviceStatus,
  EventState,
  HomeStatus,
  ResourceMetric,
  RobotStatus,
  RuntimeMode,
  ServiceStatus,
  SnapshotEnvelope,
  SnapshotMessage,
  TraeStatus,
} from "./types";

const connectionStates = new Set<ConnectionState>(["online", "degraded", "offline"]);
const runtimeModes = new Set<RuntimeMode>(["mock", "live", "hybrid"]);
const homeStates = new Set<HomeStatus["state"]>(["normal", "attention", "emergency", "unavailable"]);
const traeStates = new Set<TraeStatus["state"]>(["idle", "analyzing", "working", "blocked", "offline"]);
const robotStates = new Set<RobotStatus["state"]>(["standby", "executing", "blocked", "offline"]);
const adapterModes = new Set<DeviceStatus["adapterMode"]>(["mock", "live"]);
const deviceKinds = new Set<DeviceStatus["kind"]>(["pc", "home-node", "camera", "microphone", "badge", "robot"]);
const eventSources = new Set<ControlEvent["source"]>(["vision", "audio", "system", "trae", "robot"]);
const severities = new Set<ControlEvent["level"]>(["info", "warning", "critical"]);
const eventStates = new Set<EventState>(["detected", "acknowledged", "resolved", "escalated"]);
const commandTargets = new Set<CommandRecord["target"]>(["trae", "robot", "home-node", "system"]);
const commandStatuses = new Set<CommandRecord["status"]>(["requested", "accepted", "running", "succeeded", "failed", "expired"]);
const resourceTones = new Set<ResourceMetric["tone"]>(["green", "cyan", "yellow", "red"]);
const MAX_EVENT_HISTORY = 200;
const MAX_COMMAND_HISTORY = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string" && Boolean((record[key] as string).trim());
}

function hasStrings(record: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => hasString(record, key));
}

function isHomeStatus(value: unknown): value is HomeStatus {
  return isRecord(value)
    && homeStates.has(value.state as HomeStatus["state"])
    && hasStrings(value, ["label", "summary", "activeZone", "updatedAt"])
    && Number.isFinite(Date.parse(value.updatedAt as string));
}

function isTraeStatus(value: unknown): value is TraeStatus {
  return isRecord(value)
    && traeStates.has(value.state as TraeStatus["state"])
    && hasStrings(value, ["label", "project", "task", "suggestion", "updatedAt"])
    && Number.isFinite(Date.parse(value.updatedAt as string))
    && typeof value.progress === "number"
    && Number.isFinite(value.progress)
    && value.progress >= 0
    && value.progress <= 100;
}

function isRobotStatus(value: unknown): value is RobotStatus {
  return isRecord(value)
    && robotStates.has(value.state as RobotStatus["state"])
    && connectionStates.has(value.connection as ConnectionState)
    && hasStrings(value, ["label", "task", "updatedAt"])
    && Number.isFinite(Date.parse(value.updatedAt as string))
    && Number.isInteger(value.battery)
    && (value.battery as number) >= 0
    && (value.battery as number) <= 100;
}

function isDeviceStatus(value: unknown): value is DeviceStatus {
  return isRecord(value)
    && hasStrings(value, ["deviceId", "name", "zone", "detail", "lastSeen", "metricLabel", "metricValue"])
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.deviceId as string)
    && Number.isFinite(Date.parse(value.lastSeen as string))
    && deviceKinds.has(value.kind as DeviceStatus["kind"])
    && connectionStates.has(value.connection as ConnectionState)
    && adapterModes.has(value.adapterMode as DeviceStatus["adapterMode"]);
}

function isControlEvent(value: unknown): value is ControlEvent {
  if (!(isRecord(value)
    && value.schemaVersion === "1.0"
    && hasStrings(value, ["eventId", "deviceId", "type", "occurredAt", "updatedAt", "zone", "title", "summary"])
    && Number.isFinite(Date.parse(value.occurredAt as string))
    && Number.isFinite(Date.parse(value.updatedAt as string))
    && eventSources.has(value.source as ControlEvent["source"])
    && severities.has(value.level as ControlEvent["level"])
    && eventStates.has(value.state as EventState)
    && adapterModes.has(value.adapterMode as ControlEvent["adapterMode"])
    && (value.confidence === undefined || typeof value.confidence === "number")
    && (value.acknowledgedAt === undefined || (typeof value.acknowledgedAt === "string" && Number.isFinite(Date.parse(value.acknowledgedAt))))
    && (value.acknowledgedBy === undefined || typeof value.acknowledgedBy === "string")
    && (value.resolvedAt === undefined || (typeof value.resolvedAt === "string" && Number.isFinite(Date.parse(value.resolvedAt))))
    && (value.resolvedBy === undefined || typeof value.resolvedBy === "string")
    && isRecord(value.payload))) return false;

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

function isCommandRecord(value: unknown): value is CommandRecord {
  return isRecord(value)
    && hasStrings(value, ["commandId", "requestId", "input", "requestedAt", "updatedAt"])
    && Number.isFinite(Date.parse(value.requestedAt as string))
    && Number.isFinite(Date.parse(value.updatedAt as string))
    && commandTargets.has(value.target as CommandRecord["target"])
    && commandStatuses.has(value.status as CommandRecord["status"])
    && adapterModes.has(value.adapterMode as CommandRecord["adapterMode"])
    && (value.result === undefined || typeof value.result === "string");
}

function isServiceStatus(value: unknown): value is ServiceStatus {
  return isRecord(value)
    && hasStrings(value, ["serviceId", "name", "version", "latency", "detail"])
    && connectionStates.has(value.connection as ConnectionState)
    && adapterModes.has(value.adapterMode as ServiceStatus["adapterMode"]);
}

function isResourceMetric(value: unknown): value is ResourceMetric {
  return isRecord(value)
    && hasStrings(value, ["id", "label", "displayValue"])
    && typeof value.value === "number"
    && Number.isFinite(value.value)
    && value.value >= 0
    && value.value <= 100
    && resourceTones.has(value.tone as ResourceMetric["tone"])
    && Array.isArray(value.history)
    && value.history.length > 0
    && value.history.every((item) => (
      typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 100
    ));
}

export function isControlCenterSnapshot(value: unknown): value is ControlCenterSnapshot {
  if (!isRecord(value)) return false;
  return runtimeModes.has(value.mode as RuntimeMode)
    && connectionStates.has(value.connection as ConnectionState)
    && hasString(value, "lastSyncedAt")
    && Number.isFinite(Date.parse(value.lastSyncedAt as string))
    && isHomeStatus(value.home)
    && isTraeStatus(value.trae)
    && isRobotStatus(value.robot)
    && Array.isArray(value.devices) && value.devices.every(isDeviceStatus)
    && Array.isArray(value.events) && value.events.length <= MAX_EVENT_HISTORY && value.events.every(isControlEvent)
    && Array.isArray(value.commands) && value.commands.length <= MAX_COMMAND_HISTORY && value.commands.every(isCommandRecord)
    && Array.isArray(value.services) && value.services.every(isServiceStatus)
    && Array.isArray(value.resources) && value.resources.every(isResourceMetric);
}

export function parseSnapshotEnvelope(value: unknown): SnapshotEnvelope {
  if (!isRecord(value)
    || value.schemaVersion !== "1.0"
    || !Number.isSafeInteger(value.revision)
    || (value.revision as number) < 0
    || !isControlCenterSnapshot(value.snapshot)) {
    throw new Error("后端返回了不兼容的状态协议。需要 schemaVersion 1.0。 ");
  }
  return value as unknown as SnapshotEnvelope;
}

export function parseSnapshotMessage(value: unknown): SnapshotMessage {
  if (!isRecord(value) || value.type !== "snapshot") {
    throw new Error("WebSocket 返回了不支持的消息类型。");
  }
  return { type: "snapshot", ...parseSnapshotEnvelope(value) };
}
