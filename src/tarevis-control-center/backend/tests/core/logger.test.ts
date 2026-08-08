import assert from "node:assert/strict";
import test from "node:test";
import {
  LOG_FIELD_MAX_LENGTH,
  LOG_MESSAGE_MAX_LENGTH,
  createLogger,
} from "../../src/core/logger.js";

test("logger truncates untrusted fields, redacts secrets, and protects reserved metadata", () => {
  const original = console.log;
  const lines: string[] = [];
  console.log = (value?: unknown) => lines.push(String(value));
  try {
    createLogger("info").info("m".repeat(LOG_MESSAGE_MAX_LENGTH + 50), {
      message: "must-not-override",
      level: "debug",
      path: `/api/${"x".repeat(LOG_FIELD_MAX_LENGTH + 50)}`,
      deviceToken: "raw-device-secret",
      nested: { authorization: "Bearer raw-access-secret" },
    });
  } finally {
    console.log = original;
  }

  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]) as Record<string, unknown>;
  assert.equal(entry.level, "info");
  assert.equal((entry.message as string).length, LOG_MESSAGE_MAX_LENGTH);
  assert.equal((entry.path as string).length, LOG_FIELD_MAX_LENGTH);
  assert.equal(entry.deviceToken, "[REDACTED]");
  assert.deepEqual(entry.nested, { authorization: "[REDACTED]" });
  assert.doesNotMatch(lines[0], /raw-device-secret|raw-access-secret|must-not-override/);
});
