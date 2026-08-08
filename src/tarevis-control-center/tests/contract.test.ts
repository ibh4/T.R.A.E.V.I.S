import assert from "node:assert/strict";
import test from "node:test";
import emptySnapshot from "../backend/data/empty-snapshot.json";
import onlineDevice from "../backend/data/devices/online-device.json";
import detectedEvent from "../backend/data/events/detected-event.json";
import succeededCommand from "../backend/data/commands/succeeded-command.json";
import idleTraeStatus from "../backend/data/trae/idle-status.json";
import onlineService from "../backend/data/diagnostics/online-service.json";
import degradedService from "../backend/data/diagnostics/degraded-service.json";
import offlineService from "../backend/data/diagnostics/offline-service.json";
import cpuResource from "../backend/data/diagnostics/cpu-resource.json";
import memoryResource from "../backend/data/diagnostics/memory-resource.json";
import visionResource from "../backend/data/diagnostics/vision-resource.json";
import alertsResource from "../backend/data/diagnostics/alerts-resource.json";
import { initialMockSnapshot } from "../src/control/mock-data";
import {
  isControlCenterSnapshot,
  parseSnapshotEnvelope,
  parseSnapshotMessage,
} from "../src/control/contract";

test("the shared empty snapshot fixture satisfies the frontend contract", () => {
  assert.equal(isControlCenterSnapshot(emptySnapshot), true);
  assert.equal(emptySnapshot.home.state, "unavailable");
  assert.equal(emptySnapshot.trae.state, "offline");
  assert.equal(emptySnapshot.robot.state, "offline");
  assert.deepEqual(
    [emptySnapshot.devices, emptySnapshot.events, emptySnapshot.commands, emptySnapshot.services, emptySnapshot.resources],
    [[], [], [], [], []],
  );
});

test("REST and websocket envelopes require schema 1.0 and valid snapshots", () => {
  const envelope = { schemaVersion: "1.0", revision: 3, snapshot: emptySnapshot };
  assert.equal(parseSnapshotEnvelope(envelope).revision, 3);
  assert.equal(parseSnapshotMessage({ type: "snapshot", ...envelope }).type, "snapshot");

  assert.throws(
    () => parseSnapshotEnvelope({ ...envelope, schemaVersion: "2.0" }),
    /schemaVersion 1\.0/,
  );
  assert.throws(
    () => parseSnapshotMessage({ type: "patch", ...envelope }),
    /消息类型/,
  );
});

test("device slices require the frozen fields and adapter mode", () => {
  assert.equal(isControlCenterSnapshot({ ...emptySnapshot, devices: [onlineDevice] }), true);
  assert.equal(
    isControlCenterSnapshot({
      ...emptySnapshot,
      devices: [{ ...onlineDevice, adapterMode: undefined }],
    }),
    false,
  );
});

test("event slices require explicit state, update time, and adapter mode", () => {
  assert.equal(isControlCenterSnapshot({ ...emptySnapshot, events: [detectedEvent] }), true);
  assert.equal(
    isControlCenterSnapshot({
      ...emptySnapshot,
      events: [{ ...detectedEvent, state: undefined }],
    }),
    false,
  );
  assert.equal(
    isControlCenterSnapshot({
      ...emptySnapshot,
      events: [{ ...detectedEvent, acknowledgedAt: detectedEvent.updatedAt }],
    }),
    false,
  );
});

test("command and TRAE slices require Phase 3 identifiers, adapter mode, and status fields", () => {
  const snapshot = { ...emptySnapshot, trae: idleTraeStatus, commands: [succeededCommand] };
  assert.equal(isControlCenterSnapshot(snapshot), true);
  assert.equal(isControlCenterSnapshot(initialMockSnapshot), true);
  assert.equal(
    isControlCenterSnapshot({
      ...snapshot,
      commands: [{ ...succeededCommand, requestId: undefined }],
    }),
    false,
  );
  assert.equal(
    isControlCenterSnapshot({
      ...snapshot,
      trae: { ...idleTraeStatus, progress: 101 },
    }),
    false,
  );
});

test("RobotStatus requires the Phase 4 state, connection, battery, task, and timestamp", () => {
  assert.equal(isControlCenterSnapshot(initialMockSnapshot), true);
  assert.equal(
    isControlCenterSnapshot({
      ...initialMockSnapshot,
      robot: { ...initialMockSnapshot.robot, battery: 101 },
    }),
    false,
  );
  assert.equal(
    isControlCenterSnapshot({
      ...initialMockSnapshot,
      robot: { ...initialMockSnapshot.robot, connection: "unknown" },
    }),
    false,
  );
});

test("Diagnostics slices require adapter mode and bounded resource histories", () => {
  const diagnosticsSnapshot = {
    ...emptySnapshot,
    services: [onlineService, degradedService, offlineService],
    resources: [cpuResource, memoryResource, visionResource, alertsResource],
  };
  assert.equal(isControlCenterSnapshot(diagnosticsSnapshot), true);
  assert.equal(isControlCenterSnapshot({
    ...diagnosticsSnapshot,
    services: [{ ...onlineService, adapterMode: undefined }],
  }), false);
  assert.equal(isControlCenterSnapshot({
    ...diagnosticsSnapshot,
    resources: [{ ...cpuResource, history: [101] }],
  }), false);
});
