import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isControlCenterSnapshot, isDeviceStatus } from "../src/core/contracts.js";
import { isControlEvent } from "../src/modules/events/events-types.js";
import { isCommandRecord } from "../src/modules/commands/commands-types.js";
import { isTraeStatus } from "../src/modules/trae/trae-types.js";
import {
  parseRobotCommandInput,
  parseRobotEmergencyStopInput,
} from "../src/modules/robot/robot-types.js";
import {
  isResourceMetric,
  isServiceStatus,
} from "../src/modules/diagnostics/diagnostics-types.js";
import { createEmptySnapshot } from "../src/core/snapshot-projector.js";

test("the shared empty snapshot fixture satisfies the backend contract", async () => {
  const fixture = JSON.parse(
    await readFile(new URL("../data/empty-snapshot.json", import.meta.url), "utf8"),
  ) as unknown;

  assert.equal(isControlCenterSnapshot(fixture), true);
  assert.deepEqual(fixture, createEmptySnapshot("live", "offline"));
});

test("empty snapshots keep every collection and unavailable module state", () => {
  const snapshot = createEmptySnapshot("hybrid", "online", "2026-08-02T00:00:00.000Z");

  assert.equal(snapshot.mode, "hybrid");
  assert.equal(snapshot.home.state, "unavailable");
  assert.equal(snapshot.trae.state, "offline");
  assert.equal(snapshot.robot.state, "offline");
  assert.deepEqual(
    [snapshot.devices, snapshot.events, snapshot.commands, snapshot.services, snapshot.resources],
    [[], [], [], [], []],
  );
});

test("online, degraded, and offline device fixtures satisfy the frozen contract", async () => {
  const fixtureNames = ["online-device", "degraded-device", "offline-device"] as const;
  const fixtures = await Promise.all(fixtureNames.map(async (name) => JSON.parse(
    await readFile(new URL(`../data/devices/${name}.json`, import.meta.url), "utf8"),
  ) as unknown));

  assert.deepEqual(
    fixtures.map((fixture) => isDeviceStatus(fixture)),
    [true, true, true],
  );
  assert.deepEqual(
    fixtures.map((fixture) => (fixture as { connection: string }).connection),
    ["online", "degraded", "offline"],
  );
  assert.equal(
    isDeviceStatus({ ...(fixtures[0] as Record<string, unknown>), adapterMode: undefined }),
    false,
  );
});

test("detected, acknowledged, resolved, and escalated event fixtures satisfy the contract", async () => {
  const fixtureNames = ["detected", "acknowledged", "resolved", "escalated"] as const;
  const fixtures = await Promise.all(fixtureNames.map(async (name) => JSON.parse(
    await readFile(new URL(`../data/events/${name}-event.json`, import.meta.url), "utf8"),
  ) as unknown));

  assert.deepEqual(fixtures.map((fixture) => isControlEvent(fixture)), [true, true, true, true]);
  assert.equal(
    isControlEvent({ ...(fixtures[0] as Record<string, unknown>), adapterMode: undefined }),
    false,
  );
});

test("terminal command and TRAE status fixtures satisfy their frozen contracts", async () => {
  const commands = await Promise.all(["succeeded", "failed", "expired"].map(async (name) => JSON.parse(
    await readFile(new URL(`../data/commands/${name}-command.json`, import.meta.url), "utf8"),
  ) as unknown));
  const statuses = await Promise.all(["idle", "working", "failed", "offline"].map(async (name) => JSON.parse(
    await readFile(new URL(`../data/trae/${name}-status.json`, import.meta.url), "utf8"),
  ) as unknown));

  assert.equal(commands.every(isCommandRecord), true);
  assert.equal(statuses.every(isTraeStatus), true);
  assert.equal(
    isCommandRecord({ ...(commands[0] as Record<string, unknown>), requestId: undefined }),
    false,
  );
});

test("robot command fixtures cover valid, invalid, unconfirmed, and emergency inputs", async () => {
  const readFixture = async (name: string) => JSON.parse(
    await readFile(new URL(`../data/robot/${name}.json`, import.meta.url), "utf8"),
  ) as unknown;
  const valid = await readFixture("valid-command");
  const invalid = await readFixture("invalid-command");
  const unconfirmed = await readFixture("unconfirmed-command");
  const emergency = await readFixture("emergency-stop");

  assert.deepEqual(parseRobotCommandInput(valid), valid);
  assert.throws(() => parseRobotCommandInput(invalid), /action/);
  assert.throws(() => parseRobotCommandInput(unconfirmed), /confirmed: true/);
  assert.deepEqual(parseRobotEmergencyStopInput(emergency), {
    ...emergency as Record<string, unknown>,
    action: "emergency_stop",
    params: {},
    confirmed: true,
  });
});

test("diagnostics service and resource fixtures satisfy the Phase 5 contract", async () => {
  const services = await Promise.all(["online", "degraded", "offline"].map(async (name) => JSON.parse(
    await readFile(new URL(`../data/diagnostics/${name}-service.json`, import.meta.url), "utf8"),
  ) as unknown));
  const resources = await Promise.all(["cpu", "memory", "vision", "alerts"].map(async (name) => JSON.parse(
    await readFile(new URL(`../data/diagnostics/${name}-resource.json`, import.meta.url), "utf8"),
  ) as unknown));

  assert.equal(services.every(isServiceStatus), true);
  assert.equal(resources.every(isResourceMetric), true);
  assert.equal(
    isServiceStatus({ ...(services[0] as Record<string, unknown>), adapterMode: undefined }),
    false,
  );
  assert.equal(
    isResourceMetric({ ...(resources[0] as Record<string, unknown>), history: [101] }),
    false,
  );
});
