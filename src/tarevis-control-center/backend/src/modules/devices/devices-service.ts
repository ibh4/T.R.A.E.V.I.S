import type {
  ControlCenterModule,
  ModuleHealth,
  SnapshotSlice,
} from "../../core/contracts.js";
import {
  systemIntervalScheduler,
  type DeviceSource,
  type IntervalScheduler,
} from "./device-source.js";
import {
  connectionForHeartbeatAge,
  isDeviceSeed,
  parseDeviceHeartbeatInput,
  type DeviceHeartbeatInput,
  type DeviceStatus,
} from "./devices-types.js";
import { noopLogger, type AppLogger } from "../../core/logger.js";

const CONNECTION_CHECK_INTERVAL_MS = 1_000;

export class DeviceNotFoundError extends Error {
  constructor(readonly deviceId: string) {
    super(`Device not found: ${deviceId}`);
    this.name = "DeviceNotFoundError";
  }
}

export interface DevicesServiceOptions {
  now?: () => Date;
  scheduler?: IntervalScheduler;
  logger?: AppLogger;
}

export class DevicesService implements ControlCenterModule {
  readonly moduleId = "devices";
  private readonly devices = new Map<string, DeviceStatus>();
  private readonly listeners = new Set<() => void>();
  private readonly now: () => Date;
  private readonly scheduler: IntervalScheduler;
  private readonly logger: AppLogger;
  private connectionCheckHandle: unknown;
  private closed = false;

  constructor(
    private readonly source: DeviceSource,
    options: DevicesServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.scheduler = options.scheduler ?? systemIntervalScheduler;
    this.logger = options.logger ?? noopLogger;
    this.loadInitialDevices();
    this.startSourceAndChecks();
  }

  private loadInitialDevices(): void {
    const nowMs = this.now().getTime();
    for (const seed of this.source.getInitialDevices()) {
      if (!isDeviceSeed(seed)) throw new Error("Invalid initial device from source");
      if (this.devices.has(seed.deviceId)) {
        throw new Error(`Duplicate deviceId from source: ${seed.deviceId}`);
      }
      const lastSeenMs = Date.parse(seed.lastSeen);
      if (!Number.isFinite(lastSeenMs)) {
        throw new Error(`Invalid lastSeen for device ${seed.deviceId}`);
      }
      this.devices.set(seed.deviceId, {
        ...seed,
        connection: connectionForHeartbeatAge(Math.max(0, nowMs - lastSeenMs)),
        adapterMode: this.source.adapterMode,
      });
    }
  }

  private startSourceAndChecks(): void {
    this.source.start((deviceId, input) => {
      if (this.closed) return;
      this.heartbeat(deviceId, input);
    });
    this.connectionCheckHandle = this.scheduler.set(
      () => this.refreshConnectionStates(),
      CONNECTION_CHECK_INTERVAL_MS,
    );
  }

  listDevices(): DeviceStatus[] {
    return [...this.devices.values()].map((device) => structuredClone(device));
  }

  heartbeat(deviceId: string, input: DeviceHeartbeatInput): DeviceStatus {
    const current = this.devices.get(deviceId);
    if (!current) {
      this.logger.warn("device.not_found", { deviceId });
      throw new DeviceNotFoundError(deviceId);
    }
    const validatedInput = parseDeviceHeartbeatInput(input);

    const next: DeviceStatus = {
      ...current,
      ...validatedInput,
      connection: "online",
      lastSeen: this.now().toISOString(),
    };
    this.devices.set(deviceId, next);
    this.logger.debug("device.heartbeat", { deviceId });
    this.emitChanged();
    return structuredClone(next);
  }

  refreshConnectionStates(): boolean {
    const nowMs = this.now().getTime();
    let changed = false;
    for (const [deviceId, device] of this.devices) {
      const ageMs = Math.max(0, nowMs - Date.parse(device.lastSeen));
      const connection = connectionForHeartbeatAge(ageMs);
      if (connection === device.connection) continue;
      this.devices.set(deviceId, { ...device, connection });
      changed = true;
    }
    if (changed) this.emitChanged();
    return changed;
  }

  getSlice(): SnapshotSlice {
    return { devices: this.listDevices() };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getHealth(): ModuleHealth {
    return {
      connection: this.closed ? "offline" : "online",
      detail: this.closed
        ? "DevicesModule is closed"
        : `DevicesModule registered with ${this.devices.size} devices from ${this.source.adapterMode} source`,
    };
  }

  async reset(): Promise<void> {
    if (this.connectionCheckHandle !== undefined) {
      this.scheduler.clear(this.connectionCheckHandle);
      this.connectionCheckHandle = undefined;
    }
    await this.source.close();
    this.devices.clear();
    this.loadInitialDevices();
    this.startSourceAndChecks();
    this.logger.info("devices.reset");
    this.emitChanged();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.connectionCheckHandle !== undefined) {
      this.scheduler.clear(this.connectionCheckHandle);
      this.connectionCheckHandle = undefined;
    }
    this.listeners.clear();
    await this.source.close();
  }

  private emitChanged(): void {
    for (const listener of this.listeners) listener();
  }
}
