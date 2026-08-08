import type { LogLevel } from "../config.js";

export type LogContext = Readonly<Record<string, unknown>>;

export interface AppLogger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

const priorities: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export const LOG_MESSAGE_MAX_LENGTH = 256;
export const LOG_FIELD_MAX_LENGTH = 512;
const LOG_KEY_MAX_LENGTH = 64;
const LOG_OBJECT_MAX_FIELDS = 32;
const LOG_ARRAY_MAX_ITEMS = 20;
const LOG_MAX_DEPTH = 4;
const TRUNCATED_SUFFIX = "...[truncated]";

export const noopLogger: AppLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function createLogger(level: LogLevel): AppLogger {
  const write = (entryLevel: LogLevel, message: string, context: LogContext = {}) => {
    if (priorities[entryLevel] < priorities[level]) return;
    const line = JSON.stringify({
      ...sanitizeLogContext(context),
      timestamp: new Date().toISOString(),
      level: entryLevel,
      message: truncateLogString(message, LOG_MESSAGE_MAX_LENGTH),
    });
    if (entryLevel === "error") console.error(line);
    else if (entryLevel === "warn") console.warn(line);
    else console.log(line);
  };

  return {
    debug: (message, context) => write("debug", message, context),
    info: (message, context) => write("info", message, context),
    warn: (message, context) => write("warn", message, context),
    error: (message, context) => write("error", message, context),
  };
}

export function sanitizeLogContext(context: LogContext): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const seen = new WeakSet<object>();
  for (const [rawKey, value] of Object.entries(context).slice(0, LOG_OBJECT_MAX_FIELDS)) {
    const key = truncateLogString(rawKey, LOG_KEY_MAX_LENGTH);
    result[key] = isSensitiveLogKey(key) ? "[REDACTED]" : sanitizeLogValue(value, 0, seen);
  }
  return result;
}

function sanitizeLogValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return truncateLogString(value, LOG_FIELD_MAX_LENGTH);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: truncateLogString(value.name, LOG_FIELD_MAX_LENGTH),
      message: truncateLogString(value.message, LOG_FIELD_MAX_LENGTH),
    };
  }
  if (typeof value !== "object" || value === null) return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  if (depth >= LOG_MAX_DEPTH) return "[MAX_DEPTH]";
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.slice(0, LOG_ARRAY_MAX_ITEMS).map((item) => sanitizeLogValue(item, depth + 1, seen));
    }
    const result: Record<string, unknown> = {};
    for (const [rawKey, item] of Object.entries(value).slice(0, LOG_OBJECT_MAX_FIELDS)) {
      const key = truncateLogString(rawKey, LOG_KEY_MAX_LENGTH);
      result[key] = isSensitiveLogKey(key) ? "[REDACTED]" : sanitizeLogValue(item, depth + 1, seen);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function isSensitiveLogKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return ["token", "secret", "password", "authorization", "cookie", "apikey"]
    .some((marker) => normalized.includes(marker));
}

function truncateLogString(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return value.slice(0, maximum - TRUNCATED_SUFFIX.length) + TRUNCATED_SUFFIX;
}
