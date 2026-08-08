import type { AdapterMode } from "../../core/contracts.js";

export const COMMAND_TARGETS = ["trae", "robot", "home-node", "system"] as const;
export const COMMAND_STATUSES = [
  "requested",
  "accepted",
  "running",
  "succeeded",
  "failed",
  "expired",
] as const;
export const TERMINAL_COMMAND_STATUSES = ["succeeded", "failed", "expired"] as const;
export const MAX_COMMAND_HISTORY = 100;
export const COMMAND_INPUT_MAX_LENGTH = 2_000;
export const COMMAND_RESULT_MAX_LENGTH = 4_096;

export type CommandTarget = typeof COMMAND_TARGETS[number];
export type CommandStatus = typeof COMMAND_STATUSES[number];
export type TerminalCommandStatus = typeof TERMINAL_COMMAND_STATUSES[number];

export interface CommandRecord {
  commandId: string;
  requestId: string;
  target: CommandTarget;
  input: string;
  status: CommandStatus;
  requestedAt: string;
  updatedAt: string;
  result?: string;
  adapterMode: AdapterMode;
}

export interface CreateCommandInput {
  requestId: string;
  target: CommandTarget;
  input: string;
  adapterMode: AdapterMode;
}

const targets = new Set<CommandTarget>(COMMAND_TARGETS);
const statuses = new Set<CommandStatus>(COMMAND_STATUSES);
const adapterModes = new Set<AdapterMode>(["mock", "live"]);
const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const transitions: Readonly<Record<CommandStatus, ReadonlySet<CommandStatus>>> = {
  requested: new Set(["accepted"]),
  accepted: new Set(["running"]),
  running: new Set(TERMINAL_COMMAND_STATUSES),
  succeeded: new Set(),
  failed: new Set(),
  expired: new Set(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function canTransitionCommand(from: CommandStatus, to: CommandStatus): boolean {
  return transitions[from].has(to);
}

export function assertCreateCommandInput(value: CreateCommandInput): void {
  if (!isRecord(value)
    || typeof value.requestId !== "string"
    || !value.requestId.trim()
    || value.requestId.length > 128
    || !requestIdPattern.test(value.requestId)
    || !targets.has(value.target)
    || typeof value.input !== "string"
    || !value.input.trim()
    || value.input.length > COMMAND_INPUT_MAX_LENGTH
    || !adapterModes.has(value.adapterMode)) {
    throw new Error("Invalid command creation input");
  }
}

export function isCommandRecord(value: unknown): value is CommandRecord {
  if (!isRecord(value)) return false;
  const requiredStrings = [
    "commandId", "requestId", "input", "requestedAt", "updatedAt",
  ];
  return requiredStrings.every(
    (key) => typeof value[key] === "string" && Boolean((value[key] as string).trim()),
  )
    && Number.isFinite(Date.parse(value.requestedAt as string))
    && Number.isFinite(Date.parse(value.updatedAt as string))
    && targets.has(value.target as CommandTarget)
    && statuses.has(value.status as CommandStatus)
    && adapterModes.has(value.adapterMode as AdapterMode)
    && (value.result === undefined
      || (typeof value.result === "string" && value.result.length <= COMMAND_RESULT_MAX_LENGTH));
}
