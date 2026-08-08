import type { RuntimeMode } from "../config.js";
import {
  DEVICE_KINDS,
  type DeviceStatus,
} from "../modules/devices/devices-types.js";
import {
  isControlEvent,
  MAX_EVENT_HISTORY,
  type ControlEvent,
} from "../modules/events/events-types.js";
import {
  isCommandRecord,
  MAX_COMMAND_HISTORY,
  type CommandRecord,
} from "../modules/commands/commands-types.js";
import {
  isTraeStatus,
  type TraeStatus,
} from "../modules/trae/trae-types.js";
import {
  isRobotStatus,
  type RobotStatus,
} from "../modules/robot/robot-types.js";
import {
  isResourceMetric,
  isServiceStatus,
  type ResourceMetric,
  type ServiceStatus,
} from "../modules/diagnostics/diagnostics-types.js";

export type { DeviceStatus } from "../modules/devices/devices-types.js";
export type { ControlEvent } from "../modules/events/events-types.js";
export type { CommandRecord } from "../modules/commands/commands-types.js";
export type { TraeStatus } from "../modules/trae/trae-types.js";
export type { RobotStatus } from "../modules/robot/robot-types.js";
export type {
  ResourceMetric,
  ServiceStatus,
} from "../modules/diagnostics/diagnostics-types.js";

export const SCHEMA_VERSION = "1.0" as const;

export type ConnectionState = "online" | "degraded" | "offline";
export type AdapterMode = "mock" | "live";

export interface HomeStatus {
  state: "normal" | "attention" | "emergency" | "unavailable";
  label: string;
  summary: string;
  activeZone: string;
  updatedAt: string;
}

export interface ControlCenterSnapshot {
  mode: RuntimeMode;
  connection: ConnectionState;
  lastSyncedAt: string;
  home: HomeStatus;
  trae: TraeStatus;
  robot: RobotStatus;
  devices: DeviceStatus[];
  events: ControlEvent[];
  commands: CommandRecord[];
  services: ServiceStatus[];
  resources: ResourceMetric[];
}

export interface SnapshotEnvelope {
  schemaVersion: typeof SCHEMA_VERSION;
  revision: number;
  snapshot: ControlCenterSnapshot;
}

export interface SnapshotMessage extends SnapshotEnvelope {
  type: "snapshot";
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
  };
}

export interface ModuleHealth {
  connection: ConnectionState;
  detail: string;
}

export type SnapshotSlice = Partial<
  Pick<
    ControlCenterSnapshot,
    "home" | "trae" | "robot" | "devices" | "events" | "commands" | "services" | "resources"
  >
>;

export interface ControlCenterModule {
  readonly moduleId: string;
  getSlice(): SnapshotSlice;
  subscribe(listener: () => void): () => void;
  getHealth(): ModuleHealth;
  reset?(): void | Promise<void>;
  close(): void | Promise<void>;
}

const connectionStates = new Set<ConnectionState>(["online", "degraded", "offline"]);
const runtimeModes = new Set<RuntimeMode>(["mock", "live", "hybrid"]);
const homeStates = new Set<HomeStatus["state"]>(["normal", "attention", "emergency", "unavailable"]);
const adapterModes = new Set<AdapterMode>(["mock", "live"]);
const deviceKinds = new Set<DeviceStatus["kind"]>(DEVICE_KINDS);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string" && Boolean((record[key] as string).trim());
}

export function isDeviceStatus(value: unknown): value is DeviceStatus {
  if (!isRecord(value)) return false;
  return [
    "deviceId",
    "name",
    "zone",
    "detail",
    "lastSeen",
    "metricLabel",
    "metricValue",
  ].every((key) => hasString(value, key))
    && (value.deviceId as string).length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.deviceId as string)
    && Number.isFinite(Date.parse(value.lastSeen as string))
    && deviceKinds.has(value.kind as DeviceStatus["kind"])
    && connectionStates.has(value.connection as ConnectionState)
    && adapterModes.has(value.adapterMode as AdapterMode);
}

export function isControlCenterSnapshot(value: unknown): value is ControlCenterSnapshot {
  if (!isRecord(value)) return false;
  const home = value.home;
  const trae = value.trae;
  const robot = value.robot;
  const arrays = ["devices", "events", "commands", "services", "resources"] as const;

  return runtimeModes.has(value.mode as RuntimeMode)
    && connectionStates.has(value.connection as ConnectionState)
    && hasString(value, "lastSyncedAt")
    && Number.isFinite(Date.parse(value.lastSyncedAt as string))
    && isRecord(home)
    && homeStates.has(home.state as HomeStatus["state"])
    && ["label", "summary", "activeZone", "updatedAt"].every((key) => hasString(home, key))
    && Number.isFinite(Date.parse(home.updatedAt as string))
    && isTraeStatus(trae)
    && isRobotStatus(robot)
    && arrays.every((key) => Array.isArray(value[key]))
    && (value.events as unknown[]).length <= MAX_EVENT_HISTORY
    && (value.commands as unknown[]).length <= MAX_COMMAND_HISTORY
    && (value.devices as unknown[]).every(isDeviceStatus)
    && (value.events as unknown[]).every(isControlEvent)
    && (value.commands as unknown[]).every(isCommandRecord)
    && (value.services as unknown[]).every(isServiceStatus)
    && (value.resources as unknown[]).every(isResourceMetric);
}

export function errorEnvelope(code: string, message: string): ErrorEnvelope {
  return { error: { code, message } };
}
