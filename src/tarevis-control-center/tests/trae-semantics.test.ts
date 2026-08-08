import assert from "node:assert/strict";
import test from "node:test";
import emptySnapshot from "../backend/data/empty-snapshot.json";
import {
  getTraeAdapterMode,
  getTraeConnection,
  traeCommandResultText,
  traeCommandStatusLabel,
  traeSnapshotLabel,
  TRAE_UNREAD_RESPONSE_RESULT,
} from "../src/control/trae-semantics";
import type { CommandRecord, ControlCenterSnapshot } from "../src/control/types";

function command(status: CommandRecord["status"], result?: string): CommandRecord {
  return {
    commandId: `cmd_${status}`,
    requestId: `req_${status}`,
    target: "trae",
    input: "测试 TRAE 语义",
    status,
    requestedAt: "2026-08-04T12:00:00.000Z",
    updatedAt: "2026-08-04T12:00:01.000Z",
    ...(result === undefined ? {} : { result }),
    adapterMode: "live",
  };
}

test("TRAE command labels distinguish delivery, readable replies, failure, and unknown results", () => {
  assert.equal(traeCommandStatusLabel(command("requested")), "已请求");
  assert.equal(traeCommandStatusLabel(command("accepted")), "已进入本地队列");
  assert.equal(traeCommandStatusLabel(command("running")), "正在投递/等待结果");
  assert.equal(traeCommandStatusLabel(command("succeeded", TRAE_UNREAD_RESPONSE_RESULT)), "已发送");
  assert.equal(traeCommandStatusLabel(command("succeeded", "TRAE 回复内容")), "已读取回复");
  assert.equal(traeCommandStatusLabel(command("failed", "Bridge HTTP 503")), "发送失败");
  assert.equal(traeCommandStatusLabel(command("expired")), "调用超时，结果可能未知");
  assert.equal(traeCommandResultText(command("accepted")), "指令已进入本地队列，等待投递。");
  assert.equal(traeCommandResultText(command("expired")), "TRAE Bridge 调用超时，发送结果可能未知。");
});

test("TRAE availability follows its diagnostics service and browser connection", () => {
  const snapshot = structuredClone(emptySnapshot) as ControlCenterSnapshot;
  snapshot.mode = "hybrid";
  snapshot.services = [{
    serviceId: "trae-adapter",
    name: "TRAE Adapter",
    connection: "degraded",
    adapterMode: "live",
    version: "0.1.0",
    latency: "--",
    detail: "Bridge is degraded",
  }];
  assert.equal(getTraeConnection(snapshot), "degraded");
  assert.equal(getTraeConnection(snapshot, { phase: "offline", message: "socket closed" }), "offline");
  assert.equal(getTraeAdapterMode(snapshot), "live");

  snapshot.services[0]!.connection = "online";
  snapshot.commands = [command("succeeded", "TRAE 回复内容")];
  assert.equal(getTraeConnection(snapshot), "online");
  assert.equal(traeSnapshotLabel(snapshot), "已读取回复");
  assert.equal(getTraeAdapterMode({ ...snapshot, services: [] }), "live");
});
