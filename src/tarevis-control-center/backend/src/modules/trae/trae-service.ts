import type {
  ControlCenterModule,
  ModuleHealth,
  SnapshotSlice,
} from "../../core/contracts.js";
import type { CommandsService, CreateCommandResult } from "../commands/commands-service.js";
import {
  TERMINAL_COMMAND_STATUSES,
  type CommandRecord,
} from "../commands/commands-types.js";
import type { TraeAdapter } from "./trae-adapter.js";
import {
  TRAE_UNREAD_RESPONSE_RESULT,
  parseTraeCommandInput,
  type TraeStatus,
} from "./trae-types.js";

const projectName = "T.R.A.E.V.I.S. Control Center";

export class TraeCommandConflictError extends Error {
  constructor(readonly requestId: string) {
    super(`requestId is already used by a non-TRAE command: ${requestId}`);
    this.name = "TraeCommandConflictError";
  }
}

export class TraeModuleUnavailableError extends Error {
  constructor(readonly connection: "degraded" | "offline") {
    super(`TraeModule is ${connection}; TRAE Bridge must be ready before accepting new commands`);
    this.name = "TraeModuleUnavailableError";
  }
}

export class TraeService implements ControlCenterModule {
  readonly moduleId = "trae";
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeCommands: () => void;
  private readonly unsubscribeConnection: () => void;
  private status: TraeStatus;
  private latestCommand: CommandRecord | undefined;
  private closed = false;

  constructor(
    private readonly commands: CommandsService,
    private readonly adapter: TraeAdapter,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.status = this.statusForConnection();
    this.unsubscribeCommands = commands.subscribeTarget("trae", (command) => {
      this.latestCommand = command;
      this.status = this.projectStatus(command);
      this.emitChanged();
    });
    this.unsubscribeConnection = adapter.subscribeConnection(() => {
      this.projectConnection();
    });
  }

  submit(value: unknown): CreateCommandResult {
    const input = parseTraeCommandInput(value);
    const existing = this.commands.findByRequestId(input.requestId);
    if (existing?.target !== undefined && existing.target !== "trae") {
      throw new TraeCommandConflictError(input.requestId);
    }
    if (existing) {
      return this.commands.create({
        ...input,
        target: "trae",
        adapterMode: this.adapter.adapterMode,
      });
    }
    const connection = this.adapter.getConnection();
    if (connection !== "online") throw new TraeModuleUnavailableError(connection);
    const result = this.commands.create({
      ...input,
      target: "trae",
      adapterMode: this.adapter.adapterMode,
    });
    if (result.created) this.adapter.execute(result.command);
    return result;
  }

  getStatus(): TraeStatus {
    return structuredClone(this.status);
  }

  get adapterMode() {
    return this.adapter.adapterMode;
  }

  getSlice(): SnapshotSlice {
    return { trae: this.getStatus() };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getHealth(): ModuleHealth {
    const connection = this.closed ? "offline" : this.adapter.getConnection();
    return {
      connection,
      detail: this.closed
        ? "TraeModule is closed"
        : `TraeModule registered with ${this.adapter.adapterMode} adapter (${connection})`,
    };
  }

  async reset(): Promise<void> {
    await this.adapter.reset();
    this.latestCommand = undefined;
    this.status = this.statusForConnection();
    this.emitChanged();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeCommands();
    this.unsubscribeConnection();
    this.listeners.clear();
    await this.adapter.close();
  }

  private projectStatus(command: CommandRecord | undefined): TraeStatus {
    if (!command) return this.idleStatus();
    const base = {
      project: projectName,
      task: command.input,
      updatedAt: command.updatedAt,
    };
    switch (command.status) {
      case "requested":
        return { ...base, state: "analyzing", label: "已请求", progress: 8, suggestion: "指令已请求，等待本地接收。" };
      case "accepted":
        return { ...base, state: "analyzing", label: "已进入本地队列", progress: 28, suggestion: "指令已进入本地队列，等待投递。" };
      case "running":
        return { ...base, state: "working", label: "正在投递", progress: 68, suggestion: "正在投递指令并等待 Bridge 结果。" };
      case "succeeded":
        return {
          ...base,
          state: "idle",
          label: command.result === TRAE_UNREAD_RESPONSE_RESULT ? "已发送" : "已读取回复",
          progress: 100,
          suggestion: command.result ?? "指令已发送给 TRAE。",
        };
      case "failed":
        return { ...base, state: "blocked", label: "发送失败", progress: 100, suggestion: command.result ?? "TRAE 指令发送失败。" };
      case "expired":
        return { ...base, state: "blocked", label: "调用超时", progress: 100, suggestion: command.result ?? "TRAE Bridge 调用超时，发送结果可能未知。" };
    }
  }

  private idleStatus(): TraeStatus {
    return {
      state: "idle",
      label: "空闲",
      project: projectName,
      task: "等待新的 TRAE 指令",
      progress: 0,
      suggestion: "提交一条文本任务以开始分析。",
      updatedAt: this.now().toISOString(),
    };
  }

  private offlineStatus(): TraeStatus {
    return {
      state: "offline",
      label: "TRAE Bridge 不可用",
      project: projectName,
      task: "等待 TRAE Bridge 恢复连接",
      progress: 0,
      suggestion: "检查 trae-communicate 的 /ready 状态。",
      updatedAt: this.now().toISOString(),
    };
  }

  private statusForConnection(): TraeStatus {
    return this.adapter.getConnection() === "online" ? this.idleStatus() : this.offlineStatus();
  }

  private projectConnection(): void {
    if (this.closed) return;
    if (this.latestCommand
      && TERMINAL_COMMAND_STATUSES.some((status) => status === this.latestCommand?.status)) {
      this.emitChanged();
      return;
    }
    this.status = this.adapter.getConnection() === "online"
      ? (this.latestCommand ? this.projectStatus(this.latestCommand) : this.idleStatus())
      : this.offlineStatus();
    this.emitChanged();
  }

  private emitChanged(): void {
    for (const listener of this.listeners) listener();
  }
}
