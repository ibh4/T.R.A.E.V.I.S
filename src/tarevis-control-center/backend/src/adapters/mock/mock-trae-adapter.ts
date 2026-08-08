import type { CommandsService } from "../../modules/commands/commands-service.js";
import type { CommandRecord, TerminalCommandStatus } from "../../modules/commands/commands-types.js";
import { TRAE_BRIDGE_TIMEOUT_RESULT } from "../../modules/trae/trae-types.js";
import {
  systemTimeoutScheduler,
  type TimeoutScheduler,
  type TraeAdapter,
} from "../../modules/trae/trae-adapter.js";

export interface MockTraeAdapterOptions {
  scheduler?: TimeoutScheduler;
  acceptedDelayMs?: number;
  runningDelayMs?: number;
  terminalDelayMs?: number;
}

export class MockTraeAdapter implements TraeAdapter {
  readonly adapterMode = "mock" as const;
  private readonly scheduler: TimeoutScheduler;
  private readonly acceptedDelayMs: number;
  private readonly runningDelayMs: number;
  private readonly terminalDelayMs: number;
  private readonly handles = new Set<unknown>();
  private readonly connectionListeners = new Set<() => void>();
  private generation = 0;
  private closed = false;
  executionCount = 0;

  constructor(
    private readonly commands: CommandsService,
    options: MockTraeAdapterOptions = {},
  ) {
    this.scheduler = options.scheduler ?? systemTimeoutScheduler;
    this.acceptedDelayMs = options.acceptedDelayMs ?? 180;
    this.runningDelayMs = options.runningDelayMs ?? 480;
    this.terminalDelayMs = options.terminalDelayMs ?? 1_250;
  }

  execute(command: CommandRecord): void {
    if (this.closed) throw new Error("MockTraeAdapter is closed");
    this.executionCount += 1;
    const terminal = this.outcomeFor(command.input);
    this.schedule(() => this.commands.transition(command.commandId, "accepted"), this.acceptedDelayMs);
    this.schedule(() => this.commands.transition(command.commandId, "running"), this.runningDelayMs);
    this.schedule(() => {
      const results: Record<TerminalCommandStatus, string> = {
        succeeded: "Mock TRAE 已返回可读回复。",
        failed: "Mock TRAE 执行失败。",
        expired: TRAE_BRIDGE_TIMEOUT_RESULT,
      };
      this.commands.transition(command.commandId, terminal, results[terminal]);
    }, this.terminalDelayMs);
  }

  getConnection(): "online" | "offline" {
    return this.closed ? "offline" : "online";
  }

  subscribeConnection(listener: () => void): () => void {
    if (this.closed) return () => undefined;
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  reset(): void {
    this.generation += 1;
    for (const handle of this.handles) this.scheduler.clear(handle);
    this.handles.clear();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.reset();
    for (const listener of this.connectionListeners) listener();
    this.connectionListeners.clear();
  }

  private outcomeFor(input: string): TerminalCommandStatus {
    const normalized = input.toLowerCase();
    if (normalized.includes("[mock:fail]")) return "failed";
    if (normalized.includes("[mock:timeout]")) return "expired";
    return "succeeded";
  }

  private schedule(callback: () => void, delayMs: number): void {
    const generation = this.generation;
    let handle: unknown;
    handle = this.scheduler.set(() => {
      this.handles.delete(handle);
      if (!this.closed && generation === this.generation) callback();
    }, delayMs);
    this.handles.add(handle);
  }
}
