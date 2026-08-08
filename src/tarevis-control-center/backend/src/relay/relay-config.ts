import {
  RELAY_HEARTBEAT_INTERVAL_MS,
  RELAY_OFFLINE_AFTER_MS,
  RELAY_RECONNECT_INITIAL_MS,
  RELAY_RECONNECT_MAX_MS,
} from "./relay-protocol.js";

export interface DisabledRelayConfig {
  enabled: false;
}

export interface EnabledRelayConfig {
  enabled: true;
  url: string;
  deviceId: string;
  token: string;
  agentVersion: string;
  heartbeatMs: number;
  offlineTimeoutMs: number;
  reconnectInitialMs: number;
  reconnectMaxMs: number;
  handshakeTimeoutMs: number;
}

export type RelayConfig = DisabledRelayConfig | EnabledRelayConfig;

const AGENT_VERSION = "0.1.0";
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function readRelayConfig(env: NodeJS.ProcessEnv): RelayConfig {
  const enabled = readBoolean(env.CONTROL_CENTER_RELAY_ENABLED, "CONTROL_CENTER_RELAY_ENABLED", false);
  if (!enabled) return { enabled: false };

  const url = readRelayUrl(env.CONTROL_CENTER_RELAY_URL);
  const deviceId = requiredValue(env.CONTROL_CENTER_DEVICE_ID, "CONTROL_CENTER_DEVICE_ID");
  if (deviceId.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(deviceId)) {
    throw new Error("Invalid CONTROL_CENTER_DEVICE_ID");
  }
  const token = requiredValue(env.CONTROL_CENTER_DEVICE_TOKEN, "CONTROL_CENTER_DEVICE_TOKEN");
  if (token.length < 32 || token.length > 512 || !/^[!-~]+$/.test(token)) {
    throw new Error("Invalid CONTROL_CENTER_DEVICE_TOKEN");
  }

  const heartbeatMs = readBoundedInteger(
    env.CONTROL_CENTER_RELAY_HEARTBEAT_MS,
    "CONTROL_CENTER_RELAY_HEARTBEAT_MS",
    RELAY_HEARTBEAT_INTERVAL_MS,
    1_000,
    60_000,
  );
  const offlineTimeoutMs = readBoundedInteger(
    env.CONTROL_CENTER_RELAY_OFFLINE_TIMEOUT_MS,
    "CONTROL_CENTER_RELAY_OFFLINE_TIMEOUT_MS",
    Math.max(RELAY_OFFLINE_AFTER_MS, heartbeatMs * 3),
    heartbeatMs * 2,
    300_000,
  );
  const reconnectInitialMs = readBoundedInteger(
    env.CONTROL_CENTER_RELAY_RECONNECT_INITIAL_MS,
    "CONTROL_CENTER_RELAY_RECONNECT_INITIAL_MS",
    RELAY_RECONNECT_INITIAL_MS,
    100,
    10_000,
  );
  const reconnectMaxMs = readBoundedInteger(
    env.CONTROL_CENTER_RELAY_RECONNECT_MAX_MS,
    "CONTROL_CENTER_RELAY_RECONNECT_MAX_MS",
    RELAY_RECONNECT_MAX_MS,
    reconnectInitialMs,
    60_000,
  );
  const handshakeTimeoutMs = readBoundedInteger(
    env.CONTROL_CENTER_RELAY_HANDSHAKE_TIMEOUT_MS,
    "CONTROL_CENTER_RELAY_HANDSHAKE_TIMEOUT_MS",
    DEFAULT_HANDSHAKE_TIMEOUT_MS,
    1_000,
    60_000,
  );

  return {
    enabled: true,
    url,
    deviceId,
    token,
    agentVersion: AGENT_VERSION,
    heartbeatMs,
    offlineTimeoutMs,
    reconnectInitialMs,
    reconnectMaxMs,
    handshakeTimeoutMs,
  };
}

function readRelayUrl(value: string | undefined): string {
  const configured = requiredValue(value, "CONTROL_CENTER_RELAY_URL");
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error("Invalid CONTROL_CENTER_RELAY_URL");
  }
  const localDevelopment = url.protocol === "ws:" && loopbackHosts.has(url.hostname);
  if ((url.protocol !== "wss:" && !localDevelopment)
    || url.username
    || url.password
    || url.pathname !== "/agent/connect"
    || url.search
    || url.hash) {
    throw new Error("Invalid CONTROL_CENTER_RELAY_URL");
  }
  return url.toString();
}

function requiredValue(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Missing ${name}`);
  return normalized;
}

function readBoolean(value: string | undefined, name: string, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Invalid ${name}`);
}

function readBoundedInteger(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`Invalid ${name}`);
  }
  return parsed;
}
