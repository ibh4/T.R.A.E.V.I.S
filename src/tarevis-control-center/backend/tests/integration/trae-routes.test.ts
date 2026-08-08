import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { createControlCenterServer, type ControlCenterServer } from "../../src/server.js";

let app: ControlCenterServer;
let baseUrl: string;

beforeEach(async () => {
  app = createControlCenterServer({
    host: "127.0.0.1",
    port: 0,
    mode: "mock",
    logLevel: "error",
  });
  const address = await app.start();
  baseUrl = `http://${address.host}:${address.port}`;
});

afterEach(async () => {
  await app.close();
});

async function postCommand(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/trae/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitForStatus(commandId: string, status: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const state = await (await fetch(`${baseUrl}/api/state`)).json();
    const command = state.snapshot.commands.find(
      (item: { commandId: string }) => item.commandId === commandId,
    );
    if (command?.status === status) return state;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${commandId} to reach ${status}`);
}

test("TRAE API validates input and command target query", async () => {
  const invalid = await postCommand({ requestId: "req_invalid", input: " " });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.code, "INVALID_INPUT");

  const unknown = await postCommand({ requestId: "req_invalid", input: "任务", target: "robot" });
  assert.equal(unknown.status, 400);

  const malformed = await fetch(`${baseUrl}/api/trae/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, "INVALID_INPUT");

  const missingTarget = await fetch(`${baseUrl}/api/commands`);
  assert.equal(missingTarget.status, 400);
  const invalidTarget = await fetch(`${baseUrl}/api/commands?target=unknown`);
  assert.equal(invalidTarget.status, 400);
  const traeTarget = await fetch(`${baseUrl}/api/commands?target=trae`);
  assert.equal(traeTarget.status, 200);
  assert.deepEqual((await traeTarget.json()).commands, []);
});

test("TRAE command lifecycle enters the aggregate snapshot with one revision per change", async () => {
  const before = await (await fetch(`${baseUrl}/api/state`)).json();
  assert.equal(before.snapshot.trae.state, "idle");
  assert.deepEqual(before.snapshot.commands, []);

  const response = await postCommand({ requestId: "req_api_success", input: "汇总当前家庭事件" });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.created, true);
  assert.equal(body.command.status, "requested");
  assert.equal(body.command.adapterMode, "mock");

  const requested = await (await fetch(`${baseUrl}/api/state`)).json();
  assert.equal(requested.revision, before.revision + 1);
  assert.equal(requested.snapshot.trae.state, "analyzing");
  assert.equal(requested.snapshot.commands.length, 1);

  const finished = await waitForStatus(body.command.commandId, "succeeded");
  assert.equal(finished.revision, before.revision + 4);
  assert.equal((finished.snapshot as { trae: { state: string } }).trae.state, "idle");
  assert.equal((finished.snapshot as { trae: { progress: number } }).trae.progress, 100);

  const list = await (await fetch(`${baseUrl}/api/commands?target=trae`)).json();
  assert.equal(list.commands.length, 1);
  assert.equal(list.commands[0].result, "Mock TRAE 已返回可读回复。");
});

test("duplicate requestId returns the original command and keeps one execution record", async () => {
  const first = await postCommand({ requestId: "req_api_duplicate", input: "原始任务" });
  const firstBody = await first.json();
  const duplicate = await postCommand({ requestId: "req_api_duplicate", input: "不应执行" });
  const duplicateBody = await duplicate.json();

  assert.equal(first.status, 202);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicateBody.created, false);
  assert.equal(duplicateBody.command.commandId, firstBody.command.commandId);
  assert.equal(duplicateBody.command.input, "原始任务");
  await waitForStatus(firstBody.command.commandId, "succeeded");
  const list = await (await fetch(`${baseUrl}/api/commands?target=trae`)).json();
  assert.equal(list.commands.length, 1);
});
