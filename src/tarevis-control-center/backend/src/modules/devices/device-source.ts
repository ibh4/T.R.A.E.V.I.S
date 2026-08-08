import type { AdapterMode } from "../../core/contracts.js";
import type { DeviceHeartbeatInput, DeviceSeed } from "./devices-types.js";

export type DeviceHeartbeatListener = (
  deviceId: string,
  input: DeviceHeartbeatInput,
) => void;

export interface IntervalScheduler {
  set(callback: () => void, intervalMs: number): unknown;
  clear(handle: unknown): void;
}

export const systemIntervalScheduler: IntervalScheduler = {
  set: (callback, intervalMs) => setInterval(callback, intervalMs),
  clear: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface DeviceSource {
  readonly adapterMode: AdapterMode;
  getInitialDevices(): DeviceSeed[];
  start(listener: DeviceHeartbeatListener): void;
  close(): void | Promise<void>;
}
