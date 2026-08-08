import type {
  AdapterMode,
  ConnectionState,
} from "../../core/contracts.js";

export const RESOURCE_TONES = ["green", "cyan", "yellow", "red"] as const;

export type ResourceTone = typeof RESOURCE_TONES[number];

export interface ServiceStatus {
  serviceId: string;
  name: string;
  connection: ConnectionState;
  adapterMode: AdapterMode;
  version: string;
  latency: string;
  detail: string;
}

export interface ResourceMetric {
  id: string;
  label: string;
  value: number;
  displayValue: string;
  tone: ResourceTone;
  history: number[];
}

const connectionStates = new Set<ConnectionState>(["online", "degraded", "offline"]);
const adapterModes = new Set<AdapterMode>(["mock", "live"]);
const resourceTones = new Set<ResourceTone>(RESOURCE_TONES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNonEmptyString(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "string" && Boolean((record[key] as string).trim());
}

function isPercentage(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function isServiceStatus(value: unknown): value is ServiceStatus {
  return isRecord(value)
    && ["serviceId", "name", "version", "latency", "detail"].every(
      (key) => hasNonEmptyString(value, key),
    )
    && connectionStates.has(value.connection as ConnectionState)
    && adapterModes.has(value.adapterMode as AdapterMode);
}

export function isResourceMetric(value: unknown): value is ResourceMetric {
  return isRecord(value)
    && ["id", "label", "displayValue"].every((key) => hasNonEmptyString(value, key))
    && isPercentage(value.value)
    && resourceTones.has(value.tone as ResourceTone)
    && Array.isArray(value.history)
    && value.history.length > 0
    && value.history.every(isPercentage);
}
