import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import WebSocket from "ws";
import { RealtimeHub } from "../../src/core/realtime-hub.js";
import { createEmptySnapshot } from "../../src/core/snapshot-projector.js";

test("websocket heartbeat keeps responsive clients and removes an unresponsive client", async () => {
  const hub = new RealtimeHub(() => createEmptySnapshot("mock", "online"), {
    heartbeatIntervalMs: 20,
  });
  const server = createServer();
  server.on("upgrade", (request, socket, head) => {
    if (!hub.handleUpgrade(request, socket, head)) socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const responsive = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  let pingCount = 0;
  responsive.on("ping", () => pingCount += 1);
  await new Promise<void>((resolve, reject) => {
    responsive.once("open", resolve);
    responsive.once("error", reject);
  });
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.ok(pingCount >= 2);
  assert.equal(hub.getClientCount(), 1);

  const unresponsive = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
  await new Promise<void>((resolve, reject) => {
    unresponsive.once("open", resolve);
    unresponsive.once("error", reject);
  });
  const transport = (unresponsive as unknown as { _socket: { pause(): void; resume(): void } })._socket;
  transport.pause();
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(hub.getClientCount(), 1);
  transport.resume();

  responsive.close();
  await new Promise<void>((resolve) => responsive.once("close", () => resolve()));
  await hub.close();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
