import assert from "node:assert/strict";
import test from "node:test";
import { CommandsService, InvalidCommandTransitionError } from "../../src/modules/commands/commands-service.js";
import { canTransitionCommand } from "../../src/modules/commands/commands-types.js";

const startTime = Date.parse("2026-08-02T12:00:00.000Z");

test("CommandsService enforces lifecycle transitions and terminal protection", () => {
  let nowMs = startTime;
  const service = new CommandsService({
    now: () => new Date(nowMs),
    createCommandId: () => "cmd_test_001",
  });
  let changes = 0;
  service.subscribe(() => changes += 1);

  const created = service.create({
    requestId: "req_test_001",
    target: "trae",
    input: "汇总当前家庭事件",
    adapterMode: "mock",
  });
  assert.equal(created.created, true);
  assert.equal(created.command.status, "requested");
  assert.equal(created.command.requestedAt, "2026-08-02T12:00:00.000Z");
  assert.throws(
    () => service.transition(created.command.commandId, "running"),
    InvalidCommandTransitionError,
  );

  nowMs += 1_000;
  assert.equal(service.transition(created.command.commandId, "accepted").status, "accepted");
  nowMs += 1_000;
  assert.equal(service.transition(created.command.commandId, "running").status, "running");
  nowMs += 1_000;
  const succeeded = service.transition(created.command.commandId, "succeeded", "完成");
  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.result, "完成");
  assert.throws(
    () => service.transition(created.command.commandId, "running"),
    InvalidCommandTransitionError,
  );
  assert.equal(changes, 4);
  assert.equal(canTransitionCommand("failed", "running"), false);
});

test("requestId idempotency returns the original command without emitting or replacing input", () => {
  let generated = 0;
  const service = new CommandsService({ createCommandId: () => `cmd_${++generated}` });
  let changes = 0;
  service.subscribe(() => changes += 1);
  const first = service.create({
    requestId: "req_duplicate",
    target: "trae",
    input: "原始任务",
    adapterMode: "mock",
  });
  const duplicate = service.create({
    requestId: "req_duplicate",
    target: "trae",
    input: "不应覆盖原始任务",
    adapterMode: "mock",
  });

  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.command.commandId, first.command.commandId);
  assert.equal(duplicate.command.input, "原始任务");
  assert.equal(service.list().length, 1);
  assert.equal(changes, 1);

  const copy = service.list();
  copy[0]!.input = "mutated copy";
  assert.equal(service.list()[0]?.input, "原始任务");
});
