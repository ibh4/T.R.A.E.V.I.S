import assert from "node:assert/strict";
import test from "node:test";
import { MockRobotAdapter } from "../../src/adapters/mock/mock-robot-adapter.js";
import { CommandsService } from "../../src/modules/commands/commands-service.js";
import type { TimeoutScheduler } from "../../src/modules/trae/trae-adapter.js";
import { RobotService } from "../../src/modules/robot/robot-service.js";
import {
  parseRobotCommandInput,
  parseRobotEmergencyStopInput,
  type RobotInstruction,
} from "../../src/modules/robot/robot-types.js";

class ManualScheduler implements TimeoutScheduler {
  readonly tasks: Array<{ callback: () => void; delayMs: number; active: boolean }> = [];

  set(callback: () => void, delayMs: number): unknown {
    const task = { callback, delayMs, active: true };
    this.tasks.push(task);
    return task;
  }

  clear(handle: unknown): void {
    (handle as ManualScheduler["tasks"][number]).active = false;
  }

  runNext(): boolean {
    const task = this.tasks
      .filter((candidate) => candidate.active)
      .sort((left, right) => left.delayMs - right.delayMs)[0];
    if (!task) return false;
    task.active = false;
    task.callback();
    return true;
  }

  runAll(): void {
    while (this.runNext()) {
      // Drain all active tasks, including tasks scheduled by the next queued command.
    }
  }
}

function setup(outcomeFor?: (instruction: RobotInstruction) => "succeeded" | "failed" | "expired") {
  let generated = 0;
  const scheduler = new ManualScheduler();
  const commands = new CommandsService({ createCommandId: () => `cmd_robot_${++generated}` });
  const adapter = new MockRobotAdapter(commands, { scheduler, outcomeFor });
  const service = new RobotService(
    commands,
    adapter,
    () => new Date("2026-08-03T08:00:00.000Z"),
  );
  return { scheduler, commands, adapter, service };
}

test("robot input validation enforces whitelist, bounded integer params, and confirmation", () => {
  assert.deepEqual(parseRobotCommandInput({
    requestId: "req_forward",
    action: "forward",
    params: { distanceCm: 30 },
    confirmed: true,
  }), {
    requestId: "req_forward",
    action: "forward",
    params: { distanceCm: 30 },
    confirmed: true,
  });
  assert.throws(() => parseRobotCommandInput({
    requestId: "req_bad_action", action: "fly", params: {}, confirmed: true,
  }), /action/);
  assert.throws(() => parseRobotCommandInput({
    requestId: "req_bad_distance", action: "forward", params: { distanceCm: 101 }, confirmed: true,
  }), /distanceCm/);
  assert.throws(() => parseRobotCommandInput({
    requestId: "req_bad_angle", action: "turn_left", params: { angleDeg: 45.5 }, confirmed: true,
  }), /angleDeg/);
  assert.throws(() => parseRobotCommandInput({
    requestId: "req_unconfirmed", action: "patrol", params: {}, confirmed: false,
  }), /confirmed: true/);
  assert.throws(() => parseRobotCommandInput({
    requestId: "req_emergency", action: "emergency_stop", params: {}, confirmed: true,
  }), /emergency-stop/);
  assert.equal(parseRobotCommandInput({
    requestId: "req_stop", action: "stop", params: {}, confirmed: false,
  }).action, "stop");
  assert.deepEqual(parseRobotEmergencyStopInput({ requestId: "req_emergency" }).action, "emergency_stop");
});

test("RobotService queues commands and only the adapter terminal callback marks success", async () => {
  const { scheduler, commands, adapter, service } = setup();
  const first = service.submit({
    requestId: "req_first", action: "forward", params: { distanceCm: 30 }, confirmed: true,
  });
  const second = service.submit({
    requestId: "req_second", action: "turn_right", params: { angleDeg: 45 }, confirmed: true,
  });
  assert.equal(first.command.status, "requested");
  assert.equal(second.command.status, "requested");
  assert.equal(adapter.executionCount, 1);
  assert.equal(service.getStatus().state, "executing");

  assert.equal(scheduler.runNext(), true);
  assert.equal(commands.get(first.command.commandId).status, "accepted");
  assert.equal(commands.get(second.command.commandId).status, "requested");
  assert.equal(scheduler.runNext(), true);
  assert.equal(commands.get(first.command.commandId).status, "running");
  assert.equal(scheduler.runNext(), true);
  assert.equal(commands.get(first.command.commandId).status, "succeeded");
  assert.equal(commands.get(second.command.commandId).status, "requested");
  assert.equal(adapter.executionCount, 2);

  scheduler.runAll();
  assert.equal(commands.get(second.command.commandId).status, "succeeded");
  assert.equal(service.getStatus().state, "standby");
  assert.equal(service.getStatus().battery, 80);
  await service.close();
});

test("MockRobotAdapter returns failed and expired outcomes without synthetic success", async () => {
  const { scheduler, commands, service } = setup((instruction) => (
    instruction.action === "patrol" ? "failed" : "expired"
  ));
  const failed = service.submit({
    requestId: "req_failed", action: "patrol", params: {}, confirmed: true,
  });
  const expired = service.submit({
    requestId: "req_expired", action: "return_home", params: {}, confirmed: true,
  });
  scheduler.runAll();
  assert.equal(commands.get(failed.command.commandId).status, "failed");
  assert.equal(commands.get(expired.command.commandId).status, "expired");
  assert.equal(service.getStatus().state, "blocked");
  assert.match(service.getStatus().task, /超时/);
  await service.close();
});

test("emergency stop bypasses the queue and terminates active and pending commands", async () => {
  const { scheduler, commands, adapter, service } = setup();
  const active = service.submit({
    requestId: "req_active", action: "forward", params: { distanceCm: 20 }, confirmed: true,
  });
  const queued = service.submit({
    requestId: "req_queued", action: "patrol", params: {}, confirmed: true,
  });
  scheduler.runNext();
  assert.equal(commands.get(active.command.commandId).status, "accepted");

  const emergency = service.emergencyStop({ requestId: "req_stop" });
  assert.equal(commands.get(active.command.commandId).status, "failed");
  assert.equal(commands.get(queued.command.commandId).status, "failed");
  assert.equal(commands.get(emergency.command.commandId).status, "succeeded");
  assert.equal(adapter.executionCount, 2);
  assert.equal(scheduler.tasks.every((task) => !task.active), true);
  assert.equal(service.getStatus().state, "standby");
  assert.equal(service.getStatus().label, "紧急停止");
  assert.match(service.getStatus().task, /所有运动输出停止/);
  await service.close();
});

test("duplicate robot requestId reuses the original command and executes once", async () => {
  const { commands, adapter, service } = setup();
  const first = service.submit({
    requestId: "req_duplicate", action: "forward", params: { distanceCm: 30 }, confirmed: true,
  });
  const duplicate = service.submit({
    requestId: "req_duplicate", action: "backward", params: { distanceCm: 10 }, confirmed: true,
  });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.command.commandId, first.command.commandId);
  assert.equal(duplicate.command.input, "机器人前进 30 厘米");
  assert.equal(commands.list("robot").length, 1);
  assert.equal(adapter.executionCount, 1);
  await service.close();
});
