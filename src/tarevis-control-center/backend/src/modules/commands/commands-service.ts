import { randomUUID } from "node:crypto";
import type {
  ControlCenterModule,
  ModuleHealth,
  SnapshotSlice,
} from "../../core/contracts.js";
import {
  assertCreateCommandInput,
  canTransitionCommand,
  COMMAND_RESULT_MAX_LENGTH,
  COMMAND_STATUSES,
  MAX_COMMAND_HISTORY,
  type CommandRecord,
  type CommandStatus,
  type CommandTarget,
  type CreateCommandInput,
} from "./commands-types.js";
import { noopLogger, type AppLogger } from "../../core/logger.js";

export { MAX_COMMAND_HISTORY } from "./commands-types.js";

export class CommandNotFoundError extends Error {
  constructor(readonly commandId: string) {
    super(`Command not found: ${commandId}`);
    this.name = "CommandNotFoundError";
  }
}

export class InvalidCommandTransitionError extends Error {
  constructor(
    readonly commandId: string,
    readonly from: CommandStatus,
    readonly to: CommandStatus,
  ) {
    super(`Cannot transition command ${commandId} from ${from} to ${to}`);
    this.name = "InvalidCommandTransitionError";
  }
}

export interface CreateCommandResult {
  command: CommandRecord;
  created: boolean;
}

export interface CommandsServiceOptions {
  now?: () => Date;
  createCommandId?: () => string;
  logger?: AppLogger;
}

export class CommandsService implements ControlCenterModule {
  readonly moduleId = "commands";
  private readonly commands = new Map<string, CommandRecord>();
  private readonly commandIdByRequestId = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private readonly targetListeners = new Map<CommandTarget, Set<(command: CommandRecord) => void>>();
  private readonly now: () => Date;
  private readonly createCommandId: () => string;
  private readonly logger: AppLogger;
  private closed = false;

  constructor(options: CommandsServiceOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createCommandId = options.createCommandId ?? (() => `cmd_${randomUUID()}`);
    this.logger = options.logger ?? noopLogger;
  }

  create(input: CreateCommandInput): CreateCommandResult {
    assertCreateCommandInput(input);
    const existingId = this.commandIdByRequestId.get(input.requestId);
    if (existingId) {
      this.logger.info("command.duplicate", { requestId: input.requestId, commandId: existingId });
      return { command: this.get(existingId), created: false };
    }

    const commandId = this.createCommandId();
    if (this.commands.has(commandId)) throw new Error(`Duplicate generated commandId: ${commandId}`);
    const requestedAt = this.now().toISOString();
    const command: CommandRecord = {
      commandId,
      requestId: input.requestId,
      target: input.target,
      input: input.input,
      status: "requested",
      requestedAt,
      updatedAt: requestedAt,
      adapterMode: input.adapterMode,
    };
    this.commands.set(commandId, command);
    this.commandIdByRequestId.set(input.requestId, commandId);
    this.pruneTerminalHistory();
    this.logger.info("command.created", {
      commandId,
      requestId: input.requestId,
      target: input.target,
    });
    this.emitChanged(command);
    return { command: structuredClone(command), created: true };
  }

  transition(commandId: string, status: CommandStatus, result?: string): CommandRecord {
    if (!COMMAND_STATUSES.includes(status)
      || (result !== undefined && (typeof result !== "string" || result.length > COMMAND_RESULT_MAX_LENGTH))) {
      throw new Error("Invalid command transition input");
    }
    const current = this.commands.get(commandId);
    if (!current) throw new CommandNotFoundError(commandId);
    if (!canTransitionCommand(current.status, status)) {
      throw new InvalidCommandTransitionError(commandId, current.status, status);
    }
    const next: CommandRecord = {
      ...current,
      status,
      updatedAt: this.now().toISOString(),
    };
    if (result !== undefined) next.result = result;
    this.commands.set(commandId, next);
    this.pruneTerminalHistory();
    this.logger.info("command.transitioned", {
      commandId,
      requestId: current.requestId,
      from: current.status,
      to: status,
    });
    this.emitChanged(next);
    return structuredClone(next);
  }

  get(commandId: string): CommandRecord {
    const command = this.commands.get(commandId);
    if (!command) {
      this.logger.warn("command.not_found", { commandId });
      throw new CommandNotFoundError(commandId);
    }
    return structuredClone(command);
  }

  list(target?: CommandTarget): CommandRecord[] {
    return [...this.commands.values()]
      .filter((command) => target === undefined || command.target === target)
      .sort((left, right) => Date.parse(right.requestedAt) - Date.parse(left.requestedAt))
      .slice(0, MAX_COMMAND_HISTORY)
      .map((command) => structuredClone(command));
  }

  getSlice(): SnapshotSlice {
    return { commands: this.list() };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeTarget(
    target: CommandTarget,
    listener: (command: CommandRecord) => void,
  ): () => void {
    const listeners = this.targetListeners.get(target) ?? new Set();
    listeners.add(listener);
    this.targetListeners.set(target, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.targetListeners.delete(target);
    };
  }

  findByRequestId(requestId: string): CommandRecord | undefined {
    const commandId = this.commandIdByRequestId.get(requestId);
    return commandId ? this.get(commandId) : undefined;
  }

  getHealth(): ModuleHealth {
    return {
      connection: this.closed ? "offline" : "online",
      detail: this.closed
        ? "CommandsModule is closed"
        : `CommandsModule registered with ${this.commands.size} commands`,
    };
  }

  reset(): void {
    this.commands.clear();
    this.commandIdByRequestId.clear();
    this.logger.info("commands.reset");
    this.emitChanged();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    this.targetListeners.clear();
  }

  private emitChanged(command?: CommandRecord): void {
    for (const listener of this.listeners) listener();
    if (command) {
      for (const listener of this.targetListeners.get(command.target) ?? []) {
        listener(structuredClone(command));
      }
    }
  }

  private pruneTerminalHistory(): void {
    if (this.commands.size <= MAX_COMMAND_HISTORY) return;
    const removable = [...this.commands.values()]
      .filter((command) => ["succeeded", "failed", "expired"].includes(command.status))
      .sort((left, right) => Date.parse(left.requestedAt) - Date.parse(right.requestedAt));
    while (this.commands.size > MAX_COMMAND_HISTORY && removable.length > 0) {
      const command = removable.shift();
      if (!command) break;
      this.commands.delete(command.commandId);
      this.commandIdByRequestId.delete(command.requestId);
    }
  }
}
