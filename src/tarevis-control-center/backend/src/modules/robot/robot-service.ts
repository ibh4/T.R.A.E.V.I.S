import type {
  ControlCenterModule,
  ModuleHealth,
  SnapshotSlice,
} from "../../core/contracts.js";
import type { CommandsService, CreateCommandResult } from "../commands/commands-service.js";
import type { CommandRecord } from "../commands/commands-types.js";
import type { RobotAdapter } from "./robot-adapter.js";
import {
  formatRobotInstruction,
  parseRobotCommandInput,
  parseRobotEmergencyStopInput,
  type RobotInstruction,
  type RobotStatus,
} from "./robot-types.js";

export class RobotCommandConflictError extends Error {
  constructor(readonly requestId: string) {
    super(`requestId is already used by a non-robot command: ${requestId}`);
    this.name = "RobotCommandConflictError";
  }
}

export class RobotService implements ControlCenterModule {
  readonly moduleId = "robot";
  private readonly listeners = new Set<() => void>();
  private readonly instructionByRequestId = new Map<string, RobotInstruction>();
  private readonly batteryAccountedCommandIds = new Set<string>();
  private readonly unsubscribeCommands: () => void;
  private readonly initialBattery: number;
  private status: RobotStatus;
  private closed = false;

  constructor(
    private readonly commands: CommandsService,
    private readonly adapter: RobotAdapter,
    private readonly now: () => Date = () => new Date(),
    private battery = 82,
  ) {
    this.initialBattery = battery;
    this.status = this.standbyStatus();
    this.unsubscribeCommands = commands.subscribeTarget("robot", (changedCommand) => {
      this.accountForCompletedAction(changedCommand);
      const robotCommands = commands.list("robot");
      const current = robotCommands.find((command) => (
        this.instructionByRequestId.get(command.requestId)?.action === "emergency_stop"
        && !["succeeded", "failed", "expired"].includes(command.status)
      ))
        ?? robotCommands.find((command) => command.status === "running")
        ?? robotCommands.find((command) => command.status === "accepted")
        ?? robotCommands.find((command) => command.status === "requested")
        ?? changedCommand;
      this.status = this.projectStatus(current);
      this.emitChanged();
    });
  }

  submit(value: unknown): CreateCommandResult {
    return this.createAndExecute(parseRobotCommandInput(value), false);
  }

  emergencyStop(value: unknown): CreateCommandResult {
    const result = this.createAndExecute(parseRobotEmergencyStopInput(value), true);
    return result.created
      ? { ...result, command: this.commands.get(result.command.commandId) }
      : result;
  }

  getStatus(): RobotStatus {
    return structuredClone(this.status);
  }

  getSlice(): SnapshotSlice {
    return { robot: this.getStatus() };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getHealth(): ModuleHealth {
    return {
      connection: this.closed ? "offline" : "online",
      detail: this.closed
        ? "RobotModule is closed"
        : `RobotModule registered with ${this.adapter.adapterMode} adapter`,
    };
  }

  async reset(): Promise<void> {
    await this.adapter.reset();
    this.instructionByRequestId.clear();
    this.batteryAccountedCommandIds.clear();
    this.battery = this.initialBattery;
    this.status = this.standbyStatus();
    this.emitChanged();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeCommands();
    this.listeners.clear();
    await this.adapter.close();
  }

  private createAndExecute(instruction: RobotInstruction, emergency: boolean): CreateCommandResult {
    const existing = this.commands.findByRequestId(instruction.requestId);
    if (existing?.target !== undefined && existing.target !== "robot") {
      throw new RobotCommandConflictError(instruction.requestId);
    }
    if (!existing) this.instructionByRequestId.set(instruction.requestId, instruction);
    const result = this.commands.create({
      requestId: instruction.requestId,
      target: "robot",
      input: formatRobotInstruction(instruction),
      adapterMode: this.adapter.adapterMode,
    });
    if (result.created) {
      if (emergency) this.adapter.emergencyStop(result.command, instruction);
      else this.adapter.execute(result.command, instruction);
    }
    return result;
  }

  private projectStatus(command: CommandRecord): RobotStatus {
    const instruction = this.instructionByRequestId.get(command.requestId);
    const base = {
      connection: "online" as const,
      battery: this.battery,
      task: command.result ?? command.input,
      updatedAt: command.updatedAt,
    };
    switch (command.status) {
      case "requested": return { ...base, state: "executing", label: "等待执行" };
      case "accepted": return { ...base, state: "executing", label: "已接收" };
      case "running": return { ...base, state: "executing", label: "执行中" };
      case "succeeded": return {
        ...base,
        battery: this.battery,
        state: "standby",
        label: instruction?.action === "emergency_stop" ? "紧急停止" : "待命",
      };
      case "failed": return { ...base, state: "blocked", label: "执行失败" };
      case "expired": return { ...base, state: "blocked", label: "执行超时" };
    }
  }

  private standbyStatus(): RobotStatus {
    return {
      state: "standby",
      label: "待命",
      connection: "online",
      battery: this.battery,
      task: "等待经过确认的行动指令",
      updatedAt: this.now().toISOString(),
    };
  }

  private accountForCompletedAction(command: CommandRecord): void {
    if (command.status !== "succeeded" || this.batteryAccountedCommandIds.has(command.commandId)) return;
    this.batteryAccountedCommandIds.add(command.commandId);
    const instruction = this.instructionByRequestId.get(command.requestId);
    if (!instruction || instruction.action === "stop" || instruction.action === "emergency_stop") return;
    this.battery = Math.max(0, this.battery - (instruction.action === "patrol" ? 2 : 1));
  }

  private emitChanged(): void {
    for (const listener of this.listeners) listener();
  }
}
