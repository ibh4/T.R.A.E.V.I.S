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

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function waitForStatus(commandId: string, status: string): Promise<Record<string, any>> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const state = await (await fetch(`${baseUrl}/api/state`)).json() as Record<string, any>;
    const command = state.snapshot.commands.find(
      (item: { commandId: string }) => item.commandId === commandId,
    );
    if (command?.status === status) return state;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out waiting for ${commandId} to reach ${status}`);
}

test("Robot API rejects illegal, malformed, unconfirmed, and misplaced emergency actions", async () => {
  for (const body of [
    { requestId: "req_illegal", action: "fly", params: {}, confirmed: true },
    { requestId: "req_distance", action: "forward", params: { distanceCm: 0 }, confirmed: true },
    { requestId: "req_angle", action: "turn_left", params: { angleDeg: 181 }, confirmed: true },
    { requestId: "req_unconfirmed", action: "backward", params: { distanceCm: 20 }, confirmed: false },
    { requestId: "req_emergency", action: "emergency_stop", params: {}, confirmed: true },
    { requestId: "req_text", input: "机器人前进 30 厘米" },
  ]) {
    const response = await post("/api/robot/commands", body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_INPUT");
  }

  const malformed = await fetch(`${baseUrl}/api/robot/commands`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
});

test("Robot command lifecycle enters the aggregate snapshot and target query", async () => {
  const before = await (await fetch(`${baseUrl}/api/state`)).json();
  assert.equal(before.snapshot.robot.state, "standby");
  const response = await post("/api/robot/commands", {
    requestId: "req_api_forward",
    action: "forward",
    params: { distanceCm: 30 },
    confirmed: true,
  });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.command.input, "机器人前进 30 厘米");
  assert.equal(body.command.status, "requested");
  assert.equal(body.command.adapterMode, "mock");

  const requested = await (await fetch(`${baseUrl}/api/state`)).json();
  assert.equal(requested.snapshot.robot.state, "executing");
  assert.equal(requested.snapshot.commands.length, 1);
  const finished = await waitForStatus(body.command.commandId, "succeeded");
  assert.equal(finished.snapshot.robot.state, "standby");
  assert.equal(finished.snapshot.robot.battery, 81);
  assert.equal(finished.snapshot.commands[0].result, "Mock Robot 已返回动作完成回执。");

  const list = await (await fetch(`${baseUrl}/api/commands?target=robot`)).json();
  assert.equal(list.commands.length, 1);
  assert.equal(list.commands[0].commandId, body.command.commandId);
});

test("emergency stop immediately fails active and queued actions before succeeding", async () => {
  const active = await (await post("/api/robot/commands", {
    requestId: "req_api_active",
    action: "forward",
    params: { distanceCm: 30 },
    confirmed: true,
  })).json();
  const queued = await (await post("/api/robot/commands", {
    requestId: "req_api_queued",
    action: "patrol",
    params: {},
    confirmed: true,
  })).json();
  const stopResponse = await post("/api/robot/emergency-stop", { requestId: "req_api_stop" });
  const stop = await stopResponse.json();
  assert.equal(stopResponse.status, 202);
  assert.equal(stop.command.status, "succeeded");

  const state = await (await fetch(`${baseUrl}/api/state`)).json();
  const byId = new Map(state.snapshot.commands.map((command: Record<string, string>) => [command.commandId, command]));
  assert.equal((byId.get(active.command.commandId) as Record<string, string>).status, "failed");
  assert.equal((byId.get(queued.command.commandId) as Record<string, string>).status, "failed");
  assert.equal((byId.get(stop.command.commandId) as Record<string, string>).status, "succeeded");
  assert.equal(state.snapshot.robot.label, "紧急停止");
  assert.equal(state.snapshot.robot.task, "Mock Robot 已确认所有运动输出停止。");
});

test("duplicate requestId is idempotent and robot target history stays isolated", async () => {
  const input = {
    requestId: "req_api_duplicate_robot",
    action: "return_home",
    params: {},
    confirmed: true,
  };
  const first = await post("/api/robot/commands", input);
  const firstBody = await first.json();
  const duplicate = await post("/api/robot/commands", {
    ...input,
    action: "patrol",
  });
  const duplicateBody = await duplicate.json();
  assert.equal(first.status, 202);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicateBody.created, false);
  assert.equal(duplicateBody.command.commandId, firstBody.command.commandId);
  assert.equal(duplicateBody.command.input, "返回安全待命点");
  const robotCommands = await (await fetch(`${baseUrl}/api/commands?target=robot`)).json();
  const traeCommands = await (await fetch(`${baseUrl}/api/commands?target=trae`)).json();
  assert.equal(robotCommands.commands.length, 1);
  assert.deepEqual(traeCommands.commands, []);
});
