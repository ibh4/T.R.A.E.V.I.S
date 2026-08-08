import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readRelayConfig, type RelayConfig } from "./relay/relay-config.js";

export type RuntimeMode = "mock" | "live" | "hybrid";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type TraeAdapterSelection = "mock" | "communicate";

export interface TraeCommunicateConfig {
  url: string;
  timeoutMs: number;
  healthIntervalMs: number;
}

export interface HarnessConfig {
  projectsFile: string;
  defaultProjectPath: string;
  qwen: {
    apiKey?: string;
    baseUrl: string;
    model: string;
    timeoutMs: number;
    maxSteps: number;
  };
}

export interface AppConfig {
  host: string;
  port: number;
  mode: RuntimeMode;
  logLevel: LogLevel;
  traeAdapter?: TraeAdapterSelection;
  traeCommunicate?: TraeCommunicateConfig;
  harness?: HarnessConfig;
  relay?: RelayConfig;
}

const runtimeModes = new Set<RuntimeMode>(["mock", "live", "hybrid"]);
const logLevels = new Set<LogLevel>(["debug", "info", "warn", "error"]);
const traeAdapterSelections = new Set<TraeAdapterSelection>(["mock", "communicate"]);
const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(backendRoot, "..", "..", "..");

function readPort(value: string | undefined): number {
  const port = value === undefined ? 8780 : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`Invalid CONTROL_CENTER_PORT: ${value ?? ""}`);
  }
  return port;
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
    throw new Error(`Invalid ${name}: ${value ?? ""}`);
  }
  return parsed;
}

function readTraeCommunicateUrl(value: string | undefined): string {
  const configured = value?.trim() || "http://127.0.0.1:8766";
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(`Invalid TRAE_COMMUNICATE_URL: ${configured}`);
  }
  if (url.protocol !== "http:"
    || url.hostname !== "127.0.0.1"
    || url.username
    || url.password
    || (url.pathname !== "/" && url.pathname !== "")
    || url.search
    || url.hash) {
    throw new Error(`Invalid TRAE_COMMUNICATE_URL: ${configured}`);
  }
  return url.origin;
}

function readHttpBaseUrl(value: string | undefined): string {
  const configured = value?.trim() || "https://dashscope.aliyuncs.com/compatible-mode/v1";
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(`Invalid QWEN_BASE_URL: ${configured}`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:")
    || url.username
    || url.password
    || url.search
    || url.hash) {
    throw new Error(`Invalid QWEN_BASE_URL: ${configured}`);
  }
  return url.toString().replace(/\/$/, "");
}

export function resolveHarnessConfig(config: HarnessConfig | undefined): HarnessConfig {
  return config ?? {
    projectsFile: resolve(backendRoot, "data", "projects.local.json"),
    defaultProjectPath: repositoryRoot,
    qwen: {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      model: "qwen-plus",
      timeoutMs: 120_000,
      maxSteps: 6,
    },
  };
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const mode = env.CONTROL_CENTER_MODE ?? "mock";
  const logLevel = env.CONTROL_CENTER_LOG_LEVEL ?? "info";
  const traeAdapter = env.CONTROL_CENTER_TRAE_ADAPTER?.trim();

  if (!runtimeModes.has(mode as RuntimeMode)) {
    throw new Error(`Invalid CONTROL_CENTER_MODE: ${mode}`);
  }
  if (!logLevels.has(logLevel as LogLevel)) {
    throw new Error(`Invalid CONTROL_CENTER_LOG_LEVEL: ${logLevel}`);
  }
  if (traeAdapter !== undefined && !traeAdapterSelections.has(traeAdapter as TraeAdapterSelection)) {
    throw new Error(`Invalid CONTROL_CENTER_TRAE_ADAPTER: ${traeAdapter}`);
  }

  return {
    host: env.CONTROL_CENTER_HOST?.trim() || "127.0.0.1",
    port: readPort(env.CONTROL_CENTER_PORT),
    mode: mode as RuntimeMode,
    logLevel: logLevel as LogLevel,
    traeAdapter: traeAdapter as TraeAdapterSelection | undefined,
    traeCommunicate: {
      url: readTraeCommunicateUrl(env.TRAE_COMMUNICATE_URL),
      timeoutMs: readBoundedInteger(
        env.TRAE_COMMUNICATE_TIMEOUT_MS,
        "TRAE_COMMUNICATE_TIMEOUT_MS",
        35_000,
        1_000,
        120_000,
      ),
      healthIntervalMs: readBoundedInteger(
        env.TRAE_COMMUNICATE_HEALTH_INTERVAL_MS,
        "TRAE_COMMUNICATE_HEALTH_INTERVAL_MS",
        5_000,
        1_000,
        60_000,
      ),
    },
    harness: {
      projectsFile: resolve(
        process.cwd(),
        env.HARNESS_PROJECTS_FILE?.trim() || resolve(backendRoot, "data", "projects.local.json"),
      ),
      defaultProjectPath: resolve(
        process.cwd(),
        env.HARNESS_DEFAULT_PROJECT_PATH?.trim() || repositoryRoot,
      ),
      qwen: {
        apiKey: env.QWEN_API_KEY?.trim() || undefined,
        baseUrl: readHttpBaseUrl(env.QWEN_BASE_URL),
        model: env.QWEN_MODEL?.trim() || "qwen-plus",
        timeoutMs: readBoundedInteger(
          env.QWEN_TIMEOUT_MS,
          "QWEN_TIMEOUT_MS",
          120_000,
          5_000,
          300_000,
        ),
        maxSteps: readBoundedInteger(env.HARNESS_MAX_STEPS, "HARNESS_MAX_STEPS", 6, 1, 12),
      },
    },
    relay: readRelayConfig(env),
  };
}
