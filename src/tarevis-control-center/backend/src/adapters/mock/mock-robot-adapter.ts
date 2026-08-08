import type { CommandsService } from "../../modules/commands/commands-service.js";
import type { CommandRecord, CommandStatus, TerminalCommandStatus } from "../../modules/commands/commands-types.js";
import type { TimeoutScheduler } from "../../modules/trae/trae-adapter.js";
import { systemTimeoutScheduler } from "../../modules/trae/trae-adapter.js";
import type { RobotAdapter } from "../../modules/robot/robot-adapter.js";
import type { RobotInstruction } from "../../modules/robot/robot-types.js";

interface PendingExecution {
  command: CommandRecord;
  instruction: RobotInstruction;
}

export interface MockRobotAdapterOptions {
  scheduler?: TimeoutScheduler;
  acceptedDelayMs?: number;
  runningDelayMs?: number;
  terminalDelayMs?: number;
  outcomeFor?: (instruction: RobotInstruction) => TerminalCommandStatus;
}

export class MockRobotAdapter implements RobotAdapter {
  readonly adapterMode = "mock" as const;
  private readonly scheduler: TimeoutScheduler;
  private readonly acceptedDelayMs: number;
  private readonly runningDelayMs: number;
  private readonly terminalDelayMs: number;
  private readonly outcomeFor: (instruction: RobotInstruction) => TerminalCommandStatus;
  private readonly queue: PendingExecution[] = [];
  private readonly handles = new Set<unknown>();
  private generation = 0;
  private active: PendingExecution | undefined;
  private closed = false;
  executionCount = 0;

  constructor(
    private readonly commands: CommandsService,
    options: MockRobotAdapterOptions = {},
  ) {
    this.scheduler = options.scheduler ?? systemTimeoutScheduler;
    this.acceptedDelayMs = options.acceptedDelayMs ?? 140;
    this.runningDelayMs = options.runningDelayMs ?? 360;
    this.terminalDelayMs = options.terminalDelayMs ?? 1_050;
    this.outcomeFor = options.outcomeFor ?? (() => "succeeded");
  }

  execute(command: CommandRecord, instruction: RobotInstruction): void {
    if (this.closed) throw new Error("MockRobotAdapter is closed");
    this.queue.push({ command, instruction });
    this.pumpQueue();
  }

  emergencyStop(command: CommandRecord, instruction: RobotInstruction): void {
    if (this.closed) throw new Error("MockRobotAdapter is closed");
    const interrupted = [this.active, ...this.queue].filter(
      (item): item is PendingExecution => item !== undefined,
    );
    this.generation += 1;
    this.clearScheduledTasks();
    this.active = undefined;
    this.queue.length = 0;
    for (const item of interrupted) {
      this.failThroughLegalTransitions(item.command.commandId, "动作已由紧急停止中断。");
    }

    this.executionCount += 1;
    this.commands.transition(command.commandId, "accepted");
    this.commands.transition(command.commandId, "running");
    this.commands.transition(command.commandId, "succeeded", "Mock Robot 已确认所有运动输出停止。");
  }

  reset(): void {
    this.generation += 1;
    this.clearScheduledTasks();
    this.active = undefined;
    this.queue.length = 0;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.reset();
  }

  private pumpQueue(): void {
    if (this.closed || this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    this.active = next;
    this.executionCount += 1;
    const terminalStatus = this.outcomeFor(next.instruction);
    this.schedule(() => this.commands.transition(next.command.commandId, "accepted"), this.acceptedDelayMs);
    this.schedule(() => this.commands.transition(next.command.commandId, "running"), this.runningDelayMs);
    this.schedule(() => {
      const results: Record<TerminalCommandStatus, string> = {
        succeeded: "Mock Robot 已返回动作完成回执。",
        failed: "Mock Robot 动作执行失败。",
        expired: "Mock Robot 动作执行已超时。",
      };
      this.commands.transition(next.command.commandId, terminalStatus, results[terminalStatus]);
      this.active = undefined;
      this.pumpQueue();
    }, this.terminalDelayMs);
  }

  private failThroughLegalTransitions(commandId: string, result: string): void {
    let status: CommandStatus = this.commands.get(commandId).status;
    if (status === "requested") {
      status = this.commands.transition(commandId, "accepted").status;
    }
    if (status === "accepted") {
      status = this.commands.transition(commandId, "running").status;
    }
    if (status === "running") this.commands.transition(commandId, "failed", result);
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

  private clearScheduledTasks(): void {
    for (const handle of this.handles) this.scheduler.clear(handle);
    this.handles.clear();
  }
}
