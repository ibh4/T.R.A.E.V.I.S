import assert from "node:assert/strict";
import test from "node:test";
import { LiveTraeAdapter, TRAE_BRIDGE_TIMEOUT_RESULT, TRAE_UNREAD_RESPONSE_RESULT } from "../../src/adapters/live/live-trae-adapter.js";
import type { LogContext, AppLogger } from "../../src/core/logger.js";
import { CommandsService } from "../../src/modules/commands/commands-service.js";
import type { CommandRecord } from "../../src/modules/commands/commands-types.js";
import type { TimeoutScheduler } from "../../src/modules/trae/trae-adapter.js";
import { TraeService } from "../../src/modules/trae/trae-service.js";

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
}

function bridgePayload(
  requestId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    success: true,
    requestId,
    sent: true,
    strategy: "mock",
    message: "prompt sent",
    response: { status: "read", text: "TRAE reply" },
    sentAt: "2026-08-04T12:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function waitFor(predicate: () => boolean, message = "condition"): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${message}`);
}

function createCommands(): CommandsService {
  let sequence = 0;
  return new CommandsService({ createCommandId: () => `cmd_live_${++sequence}` });
}

function createCommand(commands: CommandsService, requestId: string, input: string): CommandRecord {
  return commands.create({
    requestId,
    target: "trae",
    input,
    adapterMode: "live",
  }).command;
}

const baseConfig = {
  url: "http://127.0.0.1:8766",
  timeoutMs: 35_000,
  healthIntervalMs: 5_000,
};

test("LiveTraeAdapter posts the frozen contract and stores a bounded readable reply", async () => {
  const commands = createCommands();
  const logs: Array<{ message: string; context: LogContext }> = [];
  const write = (message: string, context: LogContext = {}) => logs.push({ message, context });
  const logger: AppLogger = { debug: write, info: write, warn: write, error: write };
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fetchImpl = async (input: string | URL, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    const body = JSON.parse(String(init?.body)) as { requestId: string };
    return jsonResponse(bridgePayload(body.requestId, {
      response: { status: "read", text: "R".repeat(5_000) },
    }));
  };
  const adapter = new LiveTraeAdapter(commands, baseConfig, {
    fetch: fetchImpl,
    logger,
    startHealthPolling: false,
    initialConnection: "online",
  });
  const secretPrompt = "private prompt must not enter logs";
  const command = createCommand(commands, "req_read", secretPrompt);
  adapter.execute(command);

  await waitFor(() => commands.get(command.commandId).status === "succeeded", "read success");
  const completed = commands.get(command.commandId);
  assert.equal(requestUrl, "http://127.0.0.1:8766/send");
  assert.equal(requestInit?.method, "POST");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("accept"), "application/json");
  assert.equal(headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    requestId: "req_read",
    text: secretPrompt,
  });
  assert.equal(completed.result?.length, 4_096);
  assert.equal(JSON.stringify(logs).includes(secretPrompt), false);
  assert.ok(logs.some(({ message, context }) => (
    message === "trae.bridge_command_completed"
      && context.requestId === "req_read"
      && context.status === "succeeded"
  )));
  adapter.close();
});

test("unavailable and skipped replies preserve successful delivery semantics", async () => {
  for (const responseStatus of ["unavailable", "skipped"] as const) {
    const commands = createCommands();
    const fetchImpl = async (_input: string | URL, init?: RequestInit) => {
      const { requestId } = JSON.parse(String(init?.body)) as { requestId: string };
      return jsonResponse(bridgePayload(requestId, {
        response: { status: responseStatus, reason: "not readable" },
      }));
    };
    const adapter = new LiveTraeAdapter(commands, baseConfig, {
      fetch: fetchImpl,
      startHealthPolling: false,
    });
    const command = createCommand(commands, `req_${responseStatus}`, responseStatus);
    adapter.execute(command);
    await waitFor(() => commands.get(command.commandId).status === "succeeded");
    assert.equal(commands.get(command.commandId).result, TRAE_UNREAD_RESPONSE_RESULT);
    adapter.close();
  }
});

test("Bridge HTTP errors map to failed and do not break the serial queue", async () => {
  const statuses = [400, 409, 429, 500, 503];
  const commands = createCommands();
  const fetchImpl = async (_input: string | URL, init?: RequestInit) => {
    const { requestId } = JSON.parse(String(init?.body)) as { requestId: string };
    const status = statuses[Number(requestId.split("_").at(-1))];
    return jsonResponse({
      success: false,
      requestId,
      sent: false,
      strategy: "mock",
      message: `rejected ${status}`,
      response: { status: "skipped", reason: "not sent" },
      sentAt: "2026-08-04T12:00:00.000Z",
      error: { code: "REJECTED", message: `rejected ${status}` },
    }, status);
  };
  const adapter = new LiveTraeAdapter(commands, baseConfig, {
    fetch: fetchImpl,
    startHealthPolling: false,
  });
  const commandIds = statuses.map((_, index) => {
    const command = createCommand(commands, `req_http_${index}`, `HTTP ${statuses[index]}`);
    adapter.execute(command);
    return command.commandId;
  });
  await waitFor(
    () => commandIds.every((commandId) => commands.get(commandId).status === "failed"),
    "HTTP failures",
  );
  for (const [index, commandId] of commandIds.entries()) {
    assert.match(commands.get(commandId).result ?? "", new RegExp(`HTTP ${statuses[index]}`));
  }
  adapter.close();
});

test("invalid JSON, oversized bodies, mismatched IDs, and inconsistent sent flags fail safely", async () => {
  const responses = [
    new Response("not-json", { status: 200 }),
    new Response("x".repeat(70_000), { status: 200 }),
    jsonResponse(bridgePayload("req_wrong")),
    jsonResponse(bridgePayload("req_protocol", { sent: false })),
  ];
  const requests = ["req_json", "req_large", "req_expected", "req_protocol"];
  const commands = createCommands();
  let call = 0;
  const adapter = new LiveTraeAdapter(commands, baseConfig, {
    fetch: async () => responses[call++]!,
    startHealthPolling: false,
  });

  for (const requestId of requests) {
    const command = createCommand(commands, requestId, requestId);
    adapter.execute(command);
    await waitFor(() => commands.get(command.commandId).status === "failed", requestId);
  }
  assert.match(commands.list("trae").find((item) => item.requestId === "req_json")?.result ?? "", /invalid JSON/);
  assert.match(commands.list("trae").find((item) => item.requestId === "req_large")?.result ?? "", /exceeds/);
  assert.match(commands.list("trae").find((item) => item.requestId === "req_expected")?.result ?? "", /requestId/);
  assert.match(commands.list("trae").find((item) => item.requestId === "req_protocol")?.result ?? "", /inconsistent/);
  adapter.close();
});

test("backend timeout aborts the request and maps to expired without retry", async () => {
  const scheduler = new ManualScheduler();
  const commands = createCommands();
  let calls = 0;
  const fetchImpl = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
    calls += 1;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
  };
  const adapter = new LiveTraeAdapter(commands, { ...baseConfig, timeoutMs: 100 }, {
    fetch: fetchImpl,
    scheduler,
    startHealthPolling: false,
  });
  const command = createCommand(commands, "req_timeout", "timeout");
  adapter.execute(command);
  assert.equal(commands.get(command.commandId).status, "running");
  assert.equal(scheduler.runNext(), true);
  await waitFor(() => commands.get(command.commandId).status === "expired", "expired status");
  assert.equal(commands.get(command.commandId).result, TRAE_BRIDGE_TIMEOUT_RESULT);
  assert.equal(calls, 1);
  adapter.close();
});

test("concurrent commands call Bridge strictly in order", async () => {
  const commands = createCommands();
  const calls: string[] = [];
  let active = 0;
  let maxActive = 0;
  const completions: Array<(response: Response) => void> = [];
  const fetchImpl = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
    const { requestId } = JSON.parse(String(init?.body)) as { requestId: string };
    calls.push(requestId);
    active += 1;
    maxActive = Math.max(maxActive, active);
    return new Promise((resolve) => {
      completions.push((response) => {
        active -= 1;
        resolve(response);
      });
    });
  };
  const adapter = new LiveTraeAdapter(commands, baseConfig, {
    fetch: fetchImpl,
    startHealthPolling: false,
  });
  const submitted = ["req_first", "req_second", "req_third"].map((requestId) => {
    const command = createCommand(commands, requestId, requestId);
    adapter.execute(command);
    return command;
  });

  assert.deepEqual(calls, ["req_first"]);
  assert.equal(commands.get(submitted[1]!.commandId).status, "accepted");
  for (let index = 0; index < submitted.length; index += 1) {
    const command = submitted[index]!;
    completions[index]!(jsonResponse(bridgePayload(command.requestId)));
    await waitFor(() => commands.get(command.commandId).status === "succeeded");
    if (index + 1 < submitted.length) {
      await waitFor(() => calls.length === index + 2, "next queued Bridge call");
    }
  }
  assert.deepEqual(calls, ["req_first", "req_second", "req_third"]);
  assert.equal(maxActive, 1);
  adapter.close();
});

test("duplicate requestId through TraeService invokes the live Bridge once", async () => {
  const commands = createCommands();
  let calls = 0;
  const adapter = new LiveTraeAdapter(commands, baseConfig, {
    fetch: async (_input, init) => {
      calls += 1;
      const { requestId } = JSON.parse(String(init?.body)) as { requestId: string };
      return jsonResponse(bridgePayload(requestId));
    },
    startHealthPolling: false,
    initialConnection: "online",
  });
  const service = new TraeService(commands, adapter);
  const first = service.submit({ requestId: "req_duplicate_live", input: "original" });
  const duplicate = service.submit({ requestId: "req_duplicate_live", input: "different" });
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.command.commandId, first.command.commandId);
  await waitFor(() => commands.get(first.command.commandId).status === "succeeded");
  assert.equal(calls, 1);
  await service.close();
});

test("reset aborts the active request, clears queued work, and blocks old callbacks", async () => {
  const commands = createCommands();
  let calls = 0;
  let firstSignal: AbortSignal | null = null;
  const fetchImpl = async (_input: string | URL, init?: RequestInit): Promise<Response> => {
    calls += 1;
    const { requestId } = JSON.parse(String(init?.body)) as { requestId: string };
    if (calls === 1) {
      firstSignal = init?.signal ?? null;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("reset abort")), { once: true });
      });
    }
    return jsonResponse(bridgePayload(requestId));
  };
  const adapter = new LiveTraeAdapter(commands, baseConfig, {
    fetch: fetchImpl,
    startHealthPolling: false,
  });
  const active = createCommand(commands, "req_active", "active");
  const queued = createCommand(commands, "req_queued", "queued");
  adapter.execute(active);
  adapter.execute(queued);
  assert.equal(commands.get(active.commandId).status, "running");
  assert.equal(commands.get(queued.commandId).status, "accepted");

  adapter.reset();
  assert.equal(firstSignal?.aborted, true);
  const afterReset = createCommand(commands, "req_after_reset", "after reset");
  adapter.execute(afterReset);
  await waitFor(() => commands.get(afterReset.commandId).status === "succeeded", "post-reset command");
  assert.equal(commands.get(active.commandId).status, "running");
  assert.equal(commands.get(queued.commandId).status, "accepted");
  assert.equal(calls, 2);
  adapter.close();
});

test("close aborts active work, drops the queue, stops timers, and reports offline", async () => {
  const scheduler = new ManualScheduler();
  const commands = createCommands();
  let calls = 0;
  let activeSignal: AbortSignal | null = null;
  const adapter = new LiveTraeAdapter(commands, baseConfig, {
    fetch: async (_input, init) => {
      calls += 1;
      activeSignal = init?.signal ?? null;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("closed")), { once: true });
      });
    },
    scheduler,
    startHealthPolling: false,
    initialConnection: "online",
  });
  const changes: string[] = [];
  adapter.subscribeConnection(() => changes.push(adapter.getConnection()));
  const active = createCommand(commands, "req_close_active", "active");
  const queued = createCommand(commands, "req_close_queued", "queued");
  adapter.execute(active);
  adapter.execute(queued);

  adapter.close();
  adapter.close();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(activeSignal?.aborted, true);
  assert.equal(calls, 1);
  assert.equal(commands.get(active.commandId).status, "running");
  assert.equal(commands.get(queued.commandId).status, "accepted");
  assert.equal(adapter.getConnection(), "offline");
  assert.deepEqual(changes, ["offline"]);
  assert.equal(scheduler.tasks.every((task) => !task.active), true);
});

test("readiness polling emits only connection changes and recovers without restart", async () => {
  const scheduler = new ManualScheduler();
  const commands = createCommands();
  const outcomes: Array<() => Promise<Response>> = [
    async () => jsonResponse({ success: true, ready: true }),
    async () => jsonResponse({ success: false, ready: false, reason: "window missing" }, 503),
    async () => { throw new Error("connection refused"); },
    async () => jsonResponse({ success: true, ready: true }),
    async () => jsonResponse({ success: true, ready: true }),
  ];
  let calls = 0;
  const adapter = new LiveTraeAdapter(commands, baseConfig, {
    fetch: async () => outcomes[calls++]!(),
    scheduler,
  });
  const changes: string[] = [];
  adapter.subscribeConnection(() => changes.push(adapter.getConnection()));

  await waitFor(() => adapter.getConnection() === "online", "initial readiness");
  assert.deepEqual(changes, ["online"]);
  assert.equal(scheduler.runNext(), true);
  await waitFor(() => adapter.getConnection() === "degraded", "degraded readiness");
  assert.equal(scheduler.runNext(), true);
  await waitFor(() => adapter.getConnection() === "offline", "offline readiness");
  assert.equal(scheduler.runNext(), true);
  await waitFor(() => adapter.getConnection() === "online" && calls === 4, "readiness recovery");
  assert.equal(scheduler.runNext(), true);
  await waitFor(() => calls === 5, "unchanged readiness");
  assert.deepEqual(changes, ["online", "degraded", "offline", "online"]);

  adapter.close();
  assert.equal(adapter.getConnection(), "offline");
  assert.equal(scheduler.tasks.every((task) => !task.active), true);
});
