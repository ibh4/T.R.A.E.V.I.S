import { resolveHarnessConfig, type AppConfig } from "../config.js";
import { MockDeviceSource } from "../adapters/mock/mock-device-source.js";
import { MockEventSource } from "../adapters/mock/mock-event-source.js";
import { LiveTraeAdapter } from "../adapters/live/live-trae-adapter.js";
import { MockTraeAdapter } from "../adapters/mock/mock-trae-adapter.js";
import { MockRobotAdapter } from "../adapters/mock/mock-robot-adapter.js";
import { CommandsService } from "../modules/commands/commands-service.js";
import { DevicesService } from "../modules/devices/devices-service.js";
import { EventsService } from "../modules/events/events-service.js";
import { TraeService } from "../modules/trae/trae-service.js";
import type { TraeAdapter } from "../modules/trae/trae-adapter.js";
import { RobotService } from "../modules/robot/robot-service.js";
import { DiagnosticsService } from "../modules/diagnostics/diagnostics-service.js";
import { HarnessService } from "../modules/harness/harness-service.js";
import type {
  AdapterMode,
  ConnectionState,
  ControlCenterModule,
  ModuleHealth,
  SnapshotEnvelope,
} from "./contracts.js";
import { createLogger, type AppLogger } from "./logger.js";
import { RealtimeHub } from "./realtime-hub.js";
import { SnapshotProjector } from "./snapshot-projector.js";

export type ResolvedTraeAdapter = "mock" | "communicate" | "unavailable";

export function resolveTraeAdapter(config: Pick<AppConfig, "mode" | "traeAdapter">): ResolvedTraeAdapter {
  if (config.mode === "mock") return "mock";
  if (config.mode === "hybrid") {
    return config.traeAdapter === "communicate" ? "communicate" : "mock";
  }
  return config.traeAdapter === "communicate" ? "communicate" : "unavailable";
}

export class CompositionRoot {
  private readonly modules = new Map<string, ControlCenterModule>();
  private readonly unsubscribers = new Map<string, () => void>();
  readonly projector: SnapshotProjector;
  readonly realtimeHub: RealtimeHub;
  readonly devices: DevicesService | undefined;
  readonly events: EventsService | undefined;
  readonly commands: CommandsService;
  readonly trae: TraeService | undefined;
  readonly traeAdapterMode: AdapterMode;
  readonly robot: RobotService | undefined;
  readonly diagnostics: DiagnosticsService;
  readonly logger: AppLogger;
  readonly harness: HarnessService;
  private resetInFlight: Promise<SnapshotEnvelope> | undefined;

  constructor(readonly config: AppConfig) {
    const resolvedTraeAdapter = resolveTraeAdapter(config);
    if (resolvedTraeAdapter === "communicate" && !config.traeCommunicate) {
      throw new Error("TRAE communicate configuration is required for LiveTraeAdapter");
    }
    this.logger = createLogger(config.logLevel);
    this.harness = new HarnessService(resolveHarnessConfig(config.harness), this.logger);
    this.projector = new SnapshotProjector(config.mode, this.modules, undefined, this.logger);
    this.realtimeHub = new RealtimeHub(() => this.projector.project(), { logger: this.logger });
    this.devices = config.mode === "live"
      ? undefined
      : new DevicesService(new MockDeviceSource(), { logger: this.logger });
    if (this.devices) this.registerModule(this.devices);
    this.events = config.mode === "live"
      ? undefined
      : new EventsService(new MockEventSource(), { logger: this.logger });
    if (this.events) this.registerModule(this.events);
    this.commands = new CommandsService({ logger: this.logger });
    const traeAdapter = this.createTraeAdapter(resolvedTraeAdapter);
    this.traeAdapterMode = traeAdapter?.adapterMode ?? "live";
    this.trae = traeAdapter ? new TraeService(this.commands, traeAdapter) : undefined;
    this.logger.info("trae.adapter_selected", {
      mode: config.mode,
      configuredAdapter: config.traeAdapter ?? "default",
      resolvedAdapter: resolvedTraeAdapter,
      adapterMode: this.traeAdapterMode,
      available: Boolean(this.trae),
    });
    this.registerModule(this.commands, false);
    if (this.trae) this.registerModule(this.trae);
    this.robot = config.mode === "live"
      ? undefined
      : new RobotService(this.commands, new MockRobotAdapter(this.commands));
    if (this.robot) this.registerModule(this.robot);
    const devicesAdapterMode: AdapterMode = this.devices ? "mock" : "live";
    const eventsAdapterMode: AdapterMode = this.events ? "mock" : "live";
    const robotAdapterMode: AdapterMode = this.robot ? "mock" : "live";
    this.diagnostics = new DiagnosticsService({
      mode: config.mode,
      moduleSources: [
        this.diagnosticSource("devices-module", "Devices Module", devicesAdapterMode, () => this.devices, () => (
          aggregateDeviceConnection(this.devices?.listDevices() ?? [])
        )),
        this.diagnosticSource("events-module", "Events Module", eventsAdapterMode, () => this.events),
        this.diagnosticSource("trae-adapter", "TRAE Adapter", this.traeAdapterMode, () => this.trae),
        this.diagnosticSource("robot-adapter", "Robot Adapter", robotAdapterMode, () => this.robot, () => (
          this.robot?.getStatus().connection
        )),
      ],
      getDevices: () => this.devices?.listDevices() ?? [],
      getEvents: () => this.events?.listEvents() ?? [],
    });
    this.registerModule(this.diagnostics, false);
  }

  registerModule(module: ControlCenterModule, publishChanges = true): void {
    if (this.modules.has(module.moduleId)) {
      throw new Error(`Module already registered: ${module.moduleId}`);
    }
    this.modules.set(module.moduleId, module);
    if (publishChanges) {
      this.unsubscribers.set(module.moduleId, module.subscribe(() => this.realtimeHub.publish()));
    }
    this.realtimeHub.publish();
  }

  notifyCoreChanged(): void {
    this.realtimeHub.publish();
  }

  private createTraeAdapter(resolved: ResolvedTraeAdapter): TraeAdapter | undefined {
    if (resolved === "mock") return new MockTraeAdapter(this.commands);
    if (resolved === "unavailable") return undefined;
    if (!this.config.traeCommunicate) throw new Error("Missing TRAE communicate configuration");
    return new LiveTraeAdapter(this.commands, this.config.traeCommunicate, {
      logger: this.logger,
    });
  }

  private diagnosticSource(
    serviceId: string,
    name: string,
    adapterMode: AdapterMode,
    getModule: () => ControlCenterModule | undefined,
    getConnection?: () => ConnectionState | undefined,
  ) {
    return {
      serviceId,
      name,
      adapterMode,
      getHealth: () => getModule()?.getHealth(),
      getConnection,
    };
  }

  getModuleHealth(): Record<string, ModuleHealth> {
    return Object.fromEntries(
      [...this.modules].map(([moduleId, module]) => {
        try {
          return [moduleId, module.getHealth()];
        } catch (error) {
          this.logger.error("module.health_check_failed", {
            moduleId,
            error: error instanceof Error ? error.message : String(error),
          });
          return [moduleId, {
            connection: "degraded",
            detail: "Module health check failed; see backend logs",
          } satisfies ModuleHealth];
        }
      }),
    );
  }

  resetDemo(): Promise<SnapshotEnvelope> {
    if (this.resetInFlight) return this.resetInFlight;
    const operation = this.performReset();
    this.resetInFlight = operation;
    const clear = () => {
      if (this.resetInFlight === operation) this.resetInFlight = undefined;
    };
    void operation.then(clear, clear);
    return operation;
  }

  private async performReset(): Promise<SnapshotEnvelope> {
    const previousRevision = this.realtimeHub.getRevision();
    await this.realtimeHub.batch(async () => {
      await this.robot?.reset();
      await this.trae?.reset();
      this.commands.reset();
      await this.events?.reset();
      await this.devices?.reset();
      this.diagnostics.reset();
      this.realtimeHub.publish();
    });
    const envelope = this.realtimeHub.getEnvelope();
    this.logger.info("demo.reset", {
      previousRevision,
      revision: envelope.revision,
    });
    return envelope;
  }

  async close(): Promise<void> {
    for (const unsubscribe of this.unsubscribers.values()) unsubscribe();
    this.unsubscribers.clear();
    await Promise.all([...this.modules.values()].map((module) => module.close()));
    this.modules.clear();
  }
}

function aggregateDeviceConnection(devices: ReturnType<DevicesService["listDevices"]>): ConnectionState | undefined {
  if (devices.length === 0) return undefined;
  if (devices.every((device) => device.connection === "offline")) return "offline";
  if (devices.some((device) => device.connection !== "online")) return "degraded";
  return "online";
}
