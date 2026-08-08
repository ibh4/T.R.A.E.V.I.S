import type { ConnectionState } from "../../core/contracts.js";

export const ROBOT_STATES = ["standby", "executing", "blocked", "offline"] as const;
export const ROBOT_ACTIONS = [
  "forward",
  "backward",
  "turn_left",
  "turn_right",
  "patrol",
  "return_home",
  "stop",
  "emergency_stop",
] as const;
export const ROBOT_MOTION_ACTIONS = [
  "forward",
  "backward",
  "turn_left",
  "turn_right",
  "patrol",
  "return_home",
] as const;

export type RobotState = typeof ROBOT_STATES[number];
export type RobotAction = typeof ROBOT_ACTIONS[number];
export type RobotMotionAction = typeof ROBOT_MOTION_ACTIONS[number];

export interface RobotStatus {
  state: RobotState;
  label: string;
  connection: ConnectionState;
  battery: number;
  task: string;
  updatedAt: string;
}

export interface RobotCommandInput {
  requestId: string;
  action: Exclude<RobotAction, "emergency_stop">;
  params: Record<string, number>;
  confirmed: boolean;
}

export interface RobotEmergencyStopInput {
  requestId: string;
  action: "emergency_stop";
  params: Record<string, never>;
  confirmed: true;
}

export type RobotInstruction = RobotCommandInput | RobotEmergencyStopInput;

export class InvalidRobotCommandInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRobotCommandInputError";
  }
}

const states = new Set<RobotState>(ROBOT_STATES);
const actions = new Set<RobotAction>(ROBOT_ACTIONS);
const motionActions = new Set<RobotMotionAction>(ROBOT_MOTION_ACTIONS);
const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(record: Record<string, unknown>, allowedKeys: readonly string[], context: string): void {
  const allowed = new Set(allowedKeys);
  const unknownKey = Object.keys(record).find((key) => !allowed.has(key));
  if (unknownKey) throw new InvalidRobotCommandInputError(`Unknown ${context} field: ${unknownKey}`);
}

function readRequestId(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 128) {
    throw new InvalidRobotCommandInputError("requestId must be a non-empty string no longer than 128 characters");
  }
  const requestId = value.trim();
  if (!requestIdPattern.test(requestId)) {
    throw new InvalidRobotCommandInputError("requestId contains unsupported characters");
  }
  return requestId;
}

function readIntegerParam(
  params: Record<string, unknown>,
  key: "distanceCm" | "angleDeg",
  maximum: number,
): number {
  rejectUnknownKeys(params, [key], "robot params");
  const value = params[key];
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new InvalidRobotCommandInputError(`${key} must be an integer from 1 to ${maximum}`);
  }
  return value as number;
}

export function parseRobotCommandInput(value: unknown): RobotCommandInput {
  if (!isRecord(value)) {
    throw new InvalidRobotCommandInputError("Robot command body must be a JSON object");
  }
  rejectUnknownKeys(value, ["requestId", "action", "params", "confirmed"], "robot command");
  if (typeof value.action !== "string" || !actions.has(value.action as RobotAction)) {
    throw new InvalidRobotCommandInputError(`action must be one of: ${ROBOT_ACTIONS.join(", ")}`);
  }
  if (value.action === "emergency_stop") {
    throw new InvalidRobotCommandInputError("emergency_stop must use POST /api/robot/emergency-stop");
  }
  if (!isRecord(value.params)) {
    throw new InvalidRobotCommandInputError("params must be a JSON object");
  }
  if (typeof value.confirmed !== "boolean") {
    throw new InvalidRobotCommandInputError("confirmed must be a boolean");
  }

  const action = value.action as RobotCommandInput["action"];
  let params: Record<string, number> = {};
  if (action === "forward" || action === "backward") {
    params = { distanceCm: readIntegerParam(value.params, "distanceCm", 100) };
  } else if (action === "turn_left" || action === "turn_right") {
    params = { angleDeg: readIntegerParam(value.params, "angleDeg", 180) };
  } else {
    rejectUnknownKeys(value.params, [], "robot params");
  }

  if (motionActions.has(action as RobotMotionAction) && value.confirmed !== true) {
    throw new InvalidRobotCommandInputError(`${action} requires confirmed: true`);
  }
  return {
    requestId: readRequestId(value.requestId),
    action,
    params,
    confirmed: value.confirmed,
  };
}

export function parseRobotEmergencyStopInput(value: unknown): RobotEmergencyStopInput {
  if (!isRecord(value)) {
    throw new InvalidRobotCommandInputError("Robot emergency-stop body must be a JSON object");
  }
  rejectUnknownKeys(value, ["requestId"], "robot emergency-stop");
  return {
    requestId: readRequestId(value.requestId),
    action: "emergency_stop",
    params: {},
    confirmed: true,
  };
}

export function formatRobotInstruction(instruction: RobotInstruction): string {
  switch (instruction.action) {
    case "forward": return `机器人前进 ${instruction.params.distanceCm} 厘米`;
    case "backward": return `机器人后退 ${instruction.params.distanceCm} 厘米`;
    case "turn_left": return `机器人向左转 ${instruction.params.angleDeg} 度`;
    case "turn_right": return `机器人向右转 ${instruction.params.angleDeg} 度`;
    case "patrol": return "开始安全区域巡逻";
    case "return_home": return "返回安全待命点";
    case "stop": return "停止当前运动";
    case "emergency_stop": return "停止所有运动（急停）";
  }
}

export function isRobotStatus(value: unknown): value is RobotStatus {
  if (!isRecord(value)) return false;
  return states.has(value.state as RobotState)
    && ["label", "connection", "task", "updatedAt"].every((key) => typeof value[key] === "string")
    && ["label", "task", "updatedAt"].every((key) => Boolean((value[key] as string).trim()))
    && ["online", "degraded", "offline"].includes(value.connection as string)
    && Number.isInteger(value.battery)
    && (value.battery as number) >= 0
    && (value.battery as number) <= 100
    && Number.isFinite(Date.parse(value.updatedAt as string));
}
