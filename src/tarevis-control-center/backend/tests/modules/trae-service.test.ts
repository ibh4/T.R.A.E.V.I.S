import assert from "node:assert/strict";
import test from "node:test";
import { MockTraeAdapter } from "../../src/adapters/mock/mock-trae-adapter.js";
import { CommandsService } from "../../src/modules/commands/commands-service.js";
import type { TimeoutScheduler } from "../../src/modules/trae/trae-adapter.js";
import type { TraeAdapter } from "../../src/modules/trae/trae-adapter.js";
import type { ConnectionState } from "../../src/core/contracts.js";
import type { CommandRecord } from "../../src/modules/commands/commands-types.js";
import {
  TraeModuleUnavailableError,
  TraeService,
} from "../../src/modules/trae/trae-service.js";
import { parseTraeCommandInput } from "../../src/modules/trae/trae-types.js";

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

  runAll(): void {
    while (this.runNext()) {
      // Run every active task in delay order.
    }
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
}

class ControllableTraeAdapter implements TraeAdapter {
  readonly adapterMode = "live" as const;
  private readonly listeners = new Set<() => void>();
  lastCommand: CommandRecord | undefined;

  constructor(private connection: ConnectionState) {}

  execute(command: CommandRecord): void {
    this.lastCommand = command;
  }

  getConnection(): ConnectionState {
    return this.connection;
  }

  subscribeConnection(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setConnection(connection: ConnectionState): void {
    if (this.connection === connection) return;
    this.connection = connection;
    for (const listener of this.listeners) listener();
  }

  reset(): void {}

  close(): void {
    this.listeners.clear();
  }
}

function setup(input: string, commandId: string) {
  const scheduler = new ManualScheduler();
  const commands = new CommandsService({ createCommandId: () => commandId });
  const adapter = new MockTraeAdapter(commands, { scheduler });
  const service = new TraeService(commands, adapter, () => new Date("2026-08-02T12:00:00.000Z"));
  const result = service.submit({ requestId: `req_${commandId}`, input });
  return { scheduler, commands, adapter, service, result };
}

test("TRAE input validation trims bounded text and rejects unknown fields", () => {
  assert.deepEqual(
    parseTraeCommandInput({ requestId: "req_001", input: "  汇总事件  " }),
    { requestId: "req_001", input: "汇总事件" },
  );
  assert.throws(() => parseTraeCommandInput({ requestId: "req_001", input: " " }), /input/);
  assert.throws(() => parseTraeCommandInput({ requestId: "bad request", input: "任务" }), /requestId/);
  assert.throws(
    () => parseTraeCommandInput({ requestId: "req_001", input: "任务", target: "robot" }),
    /Unknown TRAE command field/,
  );
});

test("TraeService projects requested through succeeded and duplicate requestId executes once", async () => {
  const { scheduler, commands, adapter, service, result } = setup("汇总当前家庭事件", "cmd_success");
  assert.equal(result.created, true);
  assert.equal(service.getStatus().state, "analyzing");
  assert.equal(service.getStatus().progress, 8);

  const duplicate = service.submit({ requestId: "req_cmd_success", input: "不同文本" });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.command.commandId, result.command.commandId);
  assert.equal(adapter.executionCount, 1);
  assert.equal(scheduler.tasks.length, 3);

  assert.equal(scheduler.runNext(), true);
  assert.equal(commands.get(result.command.commandId).status, "accepted");
  assert.equal(service.getStatus().state, "analyzing");
  assert.equal(service.getStatus().progress, 28);
  assert.equal(scheduler.runNext(), true);
  assert.equal(commands.get(result.command.commandId).status, "running");
  assert.equal(service.getStatus().state, "working");
  assert.equal(service.getStatus().progress, 68);
  assert.equal(scheduler.runNext(), true);
  assert.equal(commands.get(result.command.commandId).status, "succeeded");
  assert.equal(service.getStatus().state, "idle");
  assert.equal(service.getStatus().progress, 100);
  assert.match(service.getStatus().suggestion, /可读回复/);
  await service.close();
});

test("MockTraeAdapter simulates failed and expired terminal results", async () => {
  for (const [input, expected, commandId] of [
    ["[mock:fail] 测试", "failed", "cmd_failed"],
    ["[mock:timeout] 测试", "expired", "cmd_expired"],
  ] as const) {
    const { scheduler, commands, service, result } = setup(input, commandId);
    scheduler.runAll();
    assert.equal(commands.get(result.command.commandId).status, expected);
    assert.equal(service.getStatus().state, "blocked");
    assert.match(service.getStatus().suggestion, expected === "failed" ? /失败/ : /超时/);
    await service.close();
  }
});

test("MockTraeAdapter cancels every pending timer on close", async () => {
  const { scheduler, commands, service, result } = setup("取消场景", "cmd_cancelled");
  await service.close();
  assert.equal(scheduler.tasks.every((task) => !task.active), true);
  scheduler.runAll();
  assert.equal(commands.get(result.command.commandId).status, "requested");
});

test("MockTraeAdapter reports online until close and emits the offline change once", () => {
  const commands = new CommandsService();
  const adapter = new MockTraeAdapter(commands);
  let changes = 0;
  adapter.subscribeConnection(() => { changes += 1; });
  assert.equal(adapter.getConnection(), "online");
  adapter.close();
  adapter.close();
  assert.equal(adapter.getConnection(), "offline");
  assert.equal(changes, 1);
});

test("TraeService projects adapter disconnect/recovery without overwriting a terminal command", async () => {
  const commands = new CommandsService({ createCommandId: () => "cmd_connection" });
  const adapter = new ControllableTraeAdapter("offline");
  const service = new TraeService(
    commands,
    adapter,
    () => new Date("2026-08-04T12:00:00.000Z"),
  );
  let notifications = 0;
  service.subscribe(() => { notifications += 1; });
  assert.equal(service.getStatus().state, "offline");
  assert.equal(service.getHealth().connection, "offline");

  adapter.setConnection("online");
  assert.equal(service.getStatus().state, "idle");
  const created = service.submit({ requestId: "req_connection", input: "connection test" });
  assert.equal(service.getStatus().state, "analyzing");
  adapter.setConnection("offline");
  assert.equal(service.getStatus().state, "offline");
  commands.transition(created.command.commandId, "accepted");
  commands.transition(created.command.commandId, "running");
  commands.transition(created.command.commandId, "succeeded", "delivered");
  assert.equal(service.getStatus().state, "idle");
  assert.equal(service.getStatus().suggestion, "delivered");

  const notificationsBeforeTerminalDisconnect = notifications;
  adapter.setConnection("degraded");
  assert.equal(service.getStatus().state, "idle");
  assert.equal(service.getHealth().connection, "degraded");
  assert.equal(notifications, notificationsBeforeTerminalDisconnect + 1);
  await service.close();
});

test("TraeService rejects new work while unavailable but preserves duplicate idempotency", async () => {
  const commands = new CommandsService({ createCommandId: () => "cmd_availability" });
  const adapter = new ControllableTraeAdapter("offline");
  const service = new TraeService(commands, adapter);

  assert.throws(
    () => service.submit({ requestId: "req_unavailable", input: "must not be created" }),
    (error: unknown) => (
      error instanceof TraeModuleUnavailableError && error.connection === "offline"
    ),
  );
  assert.deepEqual(commands.list("trae"), []);

  adapter.setConnection("online");
  const created = service.submit({ requestId: "req_available", input: "created once" });
  adapter.setConnection("degraded");
  const duplicate = service.submit({ requestId: "req_available", input: "ignored duplicate" });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.command.commandId, created.command.commandId);
  assert.equal(duplicate.command.input, "created once");
  assert.throws(
    () => service.submit({ requestId: "req_degraded", input: "must not be created" }),
    (error: unknown) => (
      error instanceof TraeModuleUnavailableError && error.connection === "degraded"
    ),
  );
  assert.equal(commands.list("trae").length, 1);
  await service.close();
});
