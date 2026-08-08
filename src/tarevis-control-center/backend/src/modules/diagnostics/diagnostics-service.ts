import os from "node:os";
import type { RuntimeMode } from "../../config.js";
import type {
  AdapterMode,
  ConnectionState,
  ControlCenterModule,
  ModuleHealth,
  SnapshotSlice,
} from "../../core/contracts.js";
import type { DeviceStatus } from "../devices/devices-types.js";
import type { ControlEvent } from "../events/events-types.js";
import type {
  ResourceMetric,
  ResourceTone,
  ServiceStatus,
} from "./diagnostics-types.js";

const MODULE_VERSION = "0.1.0";
const HISTORY_LENGTH = 7;

export interface DiagnosticModuleSource {
  serviceId: string;
  name: string;
  adapterMode: AdapterMode;
  getHealth(): ModuleHealth | undefined;
  getConnection?(): ConnectionState | undefined;
}

export interface RuntimeResourceSample {
  cpuPercent: number;
  memoryPercent: number;
  memoryDisplayValue: string;
}

export interface DiagnosticsServiceOptions {
  mode: RuntimeMode;
  moduleSources: readonly DiagnosticModuleSource[];
  getDevices(): DeviceStatus[];
  getEvents(): ControlEvent[];
  sampleRuntime?: () => RuntimeResourceSample;
}

export class DiagnosticsService implements ControlCenterModule {
  readonly moduleId = "diagnostics";
  private readonly histories = new Map<string, number[]>();
  private readonly sampleRuntime: () => RuntimeResourceSample;
  private closed = false;

  constructor(private readonly options: DiagnosticsServiceOptions) {
    this.sampleRuntime = options.sampleRuntime ?? sampleRuntimeResources;
  }

  getServices(): ServiceStatus[] {
    const defaultAdapterMode = adapterModeForRuntime(this.options.mode);
    const services: ServiceStatus[] = [{
      serviceId: "backend-core",
      name: "Control Center Backend",
      connection: this.closed ? "offline" : "online",
      adapterMode: defaultAdapterMode,
      version: MODULE_VERSION,
      latency: this.closed ? "--" : "in-process",
      detail: this.closed
        ? "Backend core is closed"
        : "HTTP, WebSocket and unified snapshot projection are available",
    }];

    for (const source of this.options.moduleSources) {
      let health: ModuleHealth | undefined;
      let observed: ConnectionState | undefined;
      try {
        health = source.getHealth();
        observed = source.getConnection?.();
      } catch (error) {
        services.push({
          serviceId: source.serviceId,
          name: source.name,
          connection: "degraded",
          adapterMode: source.adapterMode,
          version: MODULE_VERSION,
          latency: "--",
          detail: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }
      const connection = combineConnections(
        health?.connection ?? "offline",
        observed,
      );
      services.push({
        serviceId: source.serviceId,
        name: source.name,
        connection,
        adapterMode: source.adapterMode,
        version: MODULE_VERSION,
        latency: connection === "offline" ? "--" : "in-process",
        detail: health?.detail ?? `${source.name} has no ${source.adapterMode} adapter`,
      });
    }
    return structuredClone(services);
  }

  getResources(): ResourceMetric[] {
    const runtime = normalizeRuntimeSample(this.sampleRuntime());
    const devices = this.options.getDevices();
    const events = this.options.getEvents();
    const vision = createVisionMetric(devices);
    const alerts = createAlertMetric(events);

    return [
      this.metric("cpu", "PC CORE LOAD", runtime.cpuPercent, `${runtime.cpuPercent.toFixed(1)}%`, utilizationTone(runtime.cpuPercent)),
      this.metric("memory", "MEMORY BUFFER", runtime.memoryPercent, runtime.memoryDisplayValue, utilizationTone(runtime.memoryPercent)),
      this.metric("vision", "VISION PIPELINE", vision.value, vision.displayValue, vision.tone),
      this.metric("alerts", "ALERT PRESSURE", alerts.value, alerts.displayValue, alerts.tone),
    ];
  }

  getSlice(): SnapshotSlice {
    const slice: SnapshotSlice = {};
    try {
      slice.services = this.getServices();
    } catch {
      slice.services = [];
    }
    try {
      slice.resources = this.getResources();
    } catch {
      slice.resources = [];
    }
    return slice;
  }

  subscribe(): () => void {
    // Diagnostics is projected from the other modules whenever they publish.
    return () => undefined;
  }

  getHealth(): ModuleHealth {
    return {
      connection: this.closed ? "offline" : "online",
      detail: this.closed
        ? "DiagnosticsModule is closed"
        : `DiagnosticsModule aggregates ${this.options.moduleSources.length} module services`,
    };
  }

  reset(): void {
    this.histories.clear();
  }

  close(): void {
    this.closed = true;
    this.histories.clear();
  }

  private metric(
    id: string,
    label: string,
    value: number,
    displayValue: string,
    tone: ResourceTone,
  ): ResourceMetric {
    const normalizedValue = clampPercentage(value);
    const previous = this.histories.get(id) ?? [];
    const history = previous.length === 0
      ? Array<number>(HISTORY_LENGTH).fill(normalizedValue)
      : [...previous.slice(-(HISTORY_LENGTH - 1)), normalizedValue];
    this.histories.set(id, history);
    return { id, label, value: normalizedValue, displayValue, tone, history: [...history] };
  }
}

function adapterModeForRuntime(mode: RuntimeMode): AdapterMode {
  return mode === "live" ? "live" : "mock";
}

function combineConnections(
  health: ConnectionState,
  observed: ConnectionState | undefined,
): ConnectionState {
  if (health === "offline" || observed === "offline") return "offline";
  if (health === "degraded" || observed === "degraded") return "degraded";
  return "online";
}

function clampPercentage(value: number): number {
  return Math.round(Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0)) * 10) / 10;
}

function normalizeRuntimeSample(sample: RuntimeResourceSample): RuntimeResourceSample {
  return {
    cpuPercent: clampPercentage(sample.cpuPercent),
    memoryPercent: clampPercentage(sample.memoryPercent),
    memoryDisplayValue: sample.memoryDisplayValue.trim() || "UNAVAILABLE",
  };
}

function utilizationTone(value: number): ResourceTone {
  if (value >= 90) return "red";
  if (value >= 70) return "yellow";
  return "green";
}

function createVisionMetric(devices: DeviceStatus[]): Omit<ResourceMetric, "id" | "label" | "history"> {
  const visionDevice = devices.find((device) => device.metricLabel === "VISION FPS")
    ?? devices.find((device) => device.kind === "camera");
  if (!visionDevice) {
    return { value: 0, displayValue: "UNAVAILABLE", tone: "yellow" };
  }
  if (visionDevice.connection === "offline") {
    return { value: 0, displayValue: "OFFLINE", tone: "red" };
  }
  const framesPerSecond = Number.parseFloat(visionDevice.metricValue);
  if (!Number.isFinite(framesPerSecond)) {
    return { value: 0, displayValue: "UNAVAILABLE", tone: "yellow" };
  }
  return {
    value: clampPercentage((framesPerSecond / 8) * 100),
    displayValue: `${framesPerSecond.toFixed(1)} FPS`,
    tone: visionDevice.connection === "degraded" ? "yellow" : "cyan",
  };
}

function createAlertMetric(events: ControlEvent[]): Omit<ResourceMetric, "id" | "label" | "history"> {
  const unresolved = events.filter((event) => event.state !== "resolved");
  const critical = unresolved.filter((event) => event.level === "critical").length;
  const warning = unresolved.filter((event) => event.level === "warning").length;
  const active = critical + warning;
  return {
    value: clampPercentage(critical * 50 + warning * 25),
    displayValue: critical > 0
      ? `${critical} CRITICAL`
      : warning > 0
        ? `${warning} WARNING`
        : `${active} ACTIVE`,
    tone: critical > 0 ? "red" : warning > 0 ? "yellow" : "green",
  };
}

function sampleRuntimeResources(): RuntimeResourceSample {
  const cpuTime = process.cpuUsage();
  const elapsedMicroseconds = Math.max(1, process.uptime() * 1_000_000);
  const cpuPercent = ((cpuTime.user + cpuTime.system) / elapsedMicroseconds)
    * 100
    / Math.max(1, os.cpus().length);
  const memory = process.memoryUsage();
  const totalMemory = Math.max(1, os.totalmem());
  return {
    cpuPercent,
    memoryPercent: (memory.rss / totalMemory) * 100,
    memoryDisplayValue: `${formatBytes(memory.rss)} RSS`,
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}
