import type { AdapterMode } from "../../core/contracts.js";
import type { ConnectionState } from "../../core/contracts.js";
import type { CommandRecord } from "../commands/commands-types.js";

export interface TimeoutScheduler {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

export const systemTimeoutScheduler: TimeoutScheduler = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface TraeAdapter {
  readonly adapterMode: AdapterMode;
  execute(command: CommandRecord): void;
  getConnection(): ConnectionState;
  subscribeConnection(listener: () => void): () => void;
  reset(): void | Promise<void>;
  close(): void | Promise<void>;
}
