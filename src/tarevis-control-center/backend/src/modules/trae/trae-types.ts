export const TRAE_STATES = ["idle", "analyzing", "working", "blocked", "offline"] as const;
export const TRAE_COMMAND_MAX_LENGTH = 2_000;
export const TRAE_UNREAD_RESPONSE_RESULT = "指令已发送给 TRAE，但未读取到回复。";
export const TRAE_BRIDGE_TIMEOUT_RESULT = "TRAE Bridge 调用超时，发送结果可能未知。";

export type TraeState = typeof TRAE_STATES[number];

export interface TraeStatus {
  state: TraeState;
  label: string;
  project: string;
  task: string;
  progress: number;
  suggestion: string;
  updatedAt: string;
}

export interface TraeCommandInput {
  requestId: string;
  input: string;
}

export class InvalidTraeCommandInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTraeCommandInputError";
  }
}

const states = new Set<TraeState>(TRAE_STATES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredString(
  record: Record<string, unknown>,
  key: keyof TraeCommandInput,
  maximumLength: number,
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim() || value.length > maximumLength) {
    throw new InvalidTraeCommandInputError(
      `${key} must be a non-empty string no longer than ${maximumLength} characters`,
    );
  }
  return value.trim();
}

export function parseTraeCommandInput(value: unknown): TraeCommandInput {
  if (!isRecord(value)) {
    throw new InvalidTraeCommandInputError("TRAE command body must be a JSON object");
  }
  const allowedKeys = new Set<keyof TraeCommandInput>(["requestId", "input"]);
  const unknownKey = Object.keys(value).find(
    (key) => !allowedKeys.has(key as keyof TraeCommandInput),
  );
  if (unknownKey) {
    throw new InvalidTraeCommandInputError(`Unknown TRAE command field: ${unknownKey}`);
  }

  const requestId = readRequiredString(value, "requestId", 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(requestId)) {
    throw new InvalidTraeCommandInputError("requestId contains unsupported characters");
  }
  return {
    requestId,
    input: readRequiredString(value, "input", TRAE_COMMAND_MAX_LENGTH),
  };
}

export function isTraeStatus(value: unknown): value is TraeStatus {
  if (!isRecord(value)) return false;
  return states.has(value.state as TraeState)
    && ["label", "project", "task", "suggestion", "updatedAt"].every(
      (key) => typeof value[key] === "string" && Boolean((value[key] as string).trim()),
    )
    && Number.isFinite(Date.parse(value.updatedAt as string))
    && typeof value.progress === "number"
    && Number.isFinite(value.progress)
    && value.progress >= 0
    && value.progress <= 100;
}
