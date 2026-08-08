import type { AdapterMode, ConnectionState } from "../../core/contracts.js";

export const DEVICE_KINDS = [
  "pc",
  "home-node",
  "camera",
  "microphone",
  "badge",
  "robot",
] as const;

export const HEARTBEAT_INTERVAL_MS = 5_000;
export const DEGRADED_AFTER_MS = 15_000;
export const OFFLINE_AFTER_MS = 45_000;

export type DeviceKind = typeof DEVICE_KINDS[number];

export interface DeviceStatus {
  deviceId: string;
  name: string;
  kind: DeviceKind;
  zone: string;
  connection: ConnectionState;
  detail: string;
  lastSeen: string;
  metricLabel: string;
  metricValue: string;
  adapterMode: AdapterMode;
}

export interface DeviceHeartbeatInput {
  detail?: string;
  metricLabel?: string;
  metricValue?: string;
}

export interface DeviceSeed extends Omit<DeviceStatus, "connection" | "adapterMode"> {}

export class InvalidDeviceHeartbeatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDeviceHeartbeatError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDeviceSeed(value: unknown): value is DeviceSeed {
  if (!isRecord(value)) return false;
  const boundedStrings: ReadonlyArray<readonly [string, number]> = [
    ["deviceId", 128], ["name", 256], ["zone", 128], ["detail", 512],
    ["lastSeen", 64], ["metricLabel", 64], ["metricValue", 64],
  ];
  return boundedStrings.every(([key, maximum]) => (
    typeof value[key] === "string"
      && Boolean((value[key] as string).trim())
      && (value[key] as string).length <= maximum
  ))
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.deviceId as string)
    && DEVICE_KINDS.includes(value.kind as DeviceKind)
    && Number.isFinite(Date.parse(value.lastSeen as string));
}

function readOptionalString(
  record: Record<string, unknown>,
  key: keyof DeviceHeartbeatInput,
  maximumLength: number,
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > maximumLength) {
    throw new InvalidDeviceHeartbeatError(
      `${key} must be a non-empty string no longer than ${maximumLength} characters`,
    );
  }
  return value.trim();
}

export function parseDeviceHeartbeatInput(value: unknown): DeviceHeartbeatInput {
  if (!isRecord(value)) {
    throw new InvalidDeviceHeartbeatError("Heartbeat body must be a JSON object");
  }

  const allowedKeys = new Set<keyof DeviceHeartbeatInput>([
    "detail",
    "metricLabel",
    "metricValue",
  ]);
  const unknownKey = Object.keys(value).find(
    (key) => !allowedKeys.has(key as keyof DeviceHeartbeatInput),
  );
  if (unknownKey) {
    throw new InvalidDeviceHeartbeatError(`Unknown heartbeat field: ${unknownKey}`);
  }

  const input: DeviceHeartbeatInput = {};
  const detail = readOptionalString(value, "detail", 512);
  const metricLabel = readOptionalString(value, "metricLabel", 64);
  const metricValue = readOptionalString(value, "metricValue", 64);
  if (detail !== undefined) input.detail = detail;
  if (metricLabel !== undefined) input.metricLabel = metricLabel;
  if (metricValue !== undefined) input.metricValue = metricValue;
  return input;
}

export function connectionForHeartbeatAge(ageMs: number): ConnectionState {
  if (ageMs >= OFFLINE_AFTER_MS) return "offline";
  if (ageMs >= DEGRADED_AFTER_MS) return "degraded";
  return "online";
}
