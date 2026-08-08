import assert from "node:assert/strict";
import test from "node:test";
import {
  RELAY_HARNESS_CHAT_TIMEOUT_MS,
  RELAY_HEARTBEAT_INTERVAL_MS,
  RELAY_OFFLINE_AFTER_MS,
  RELAY_RECONNECT_INITIAL_MS,
  RELAY_RECONNECT_MAX_MS,
  RELAY_RPC_DEFAULT_TIMEOUT_MS,
  RELAY_RPC_REQUEST_BODY_MAX_BYTES,
  RELAY_RPC_RESPONSE_BODY_MAX_BYTES,
  RelayProtocolError,
  classifyRpcRequest,
  classifyRpcResponse,
  classifySnapshotRevision,
  createRelayErrorEnvelope,
  parseRelayErrorEnvelope,
  parseRelayMessage,
  parseRelayMessageJson,
  rpcTimeoutMsForPath,
  serializeRelayMessage,
  type RelayErrorCode,
} from "../../src/relay/relay-protocol.js";
import {
  absoluteUrlFixture,
  conflictingRpcRequestFixture,
  conflictingRpcResponseFixture,
  duplicateRpcRequestFixture,
  duplicateRpcResponseFixture,
  forbiddenHeaderFixture,
  missingDeviceIdFixture,
  oversizedRequestBodyFixture,
  staleSnapshotFixture,
  unknownTypeFixture,
  validAgentError,
  validHeartbeat,
  validHello,
  validRelayMessages,
  validRpcRequest,
  validRpcResponse,
  validSnapshot,
  wrongVersionFixture,
} from "./fixtures.js";

test("all legal relay message fixtures parse and round-trip", () => {
  for (const fixture of validRelayMessages) {
    assert.deepEqual(parseRelayMessage(structuredClone(fixture)), fixture);
    assert.deepEqual(parseRelayMessageJson(serializeRelayMessage(fixture)), fixture);
  }
});

test("the parser rejects missing fields, unknown types, invalid JSON, and unsupported versions", () => {
  assertProtocolError(() => parseRelayMessage(missingDeviceIdFixture), "INVALID_MESSAGE");
  assertProtocolError(() => parseRelayMessage(unknownTypeFixture), "UNKNOWN_MESSAGE_TYPE");
  assertProtocolError(() => parseRelayMessage(wrongVersionFixture), "UNSUPPORTED_PROTOCOL");
  assertProtocolError(() => parseRelayMessageJson("{not-json"), "INVALID_JSON");
});

test("agent.hello is the only message allowed to carry a device token", () => {
  assert.equal(parseRelayMessage(validHello).type, "agent.hello");
  assertProtocolError(
    () => parseRelayMessage({ ...validHeartbeat, token: validHello.token }),
    "INVALID_MESSAGE",
  );
  assertProtocolError(
    () => parseRelayMessage({ ...validAgentError, localPath: "C:\\private\\project" }),
    "INVALID_MESSAGE",
  );
});

test("RPC requests allow only local API paths, required methods, and whitelisted headers", () => {
  for (const method of ["GET", "POST", "PATCH", "DELETE"] as const) {
    const body = method === "POST" || method === "PATCH" ? "{}" : undefined;
    assert.equal(parseRelayMessage({ ...validRpcRequest, method, body }).type, "rpc.request");
  }
  assert.equal(parseRelayMessage({
    ...validRpcRequest,
    method: "GET",
    path: "/api/harness/projects/demo/file?path=src%2Findex.ts",
    body: undefined,
  }).type, "rpc.request");

  assertProtocolError(() => parseRelayMessage({ ...validRpcRequest, method: "PUT" }), "RPC_METHOD_NOT_ALLOWED");
  assertProtocolError(() => parseRelayMessage(absoluteUrlFixture), "RPC_PATH_NOT_ALLOWED");
  assertProtocolError(() => parseRelayMessage({ ...validRpcRequest, path: "/api/../private" }), "RPC_PATH_NOT_ALLOWED");
  assertProtocolError(() => parseRelayMessage({ ...validRpcRequest, path: "C:\\api\\state" }), "RPC_PATH_NOT_ALLOWED");
  assertProtocolError(
    () => parseRelayMessage({ ...validRpcRequest, path: "/api/harness/projects/demo/file?path=C%3A%5Csecret" }),
    "RPC_PATH_NOT_ALLOWED",
  );
  assertProtocolError(
    () => parseRelayMessage({ ...validRpcRequest, path: "/api/harness/projects/demo/file?path=%2Fetc%2Fpasswd" }),
    "RPC_PATH_NOT_ALLOWED",
  );
  assertProtocolError(() => parseRelayMessage(forbiddenHeaderFixture), "RPC_HEADER_NOT_ALLOWED");
  assertProtocolError(
    () => parseRelayMessage({ ...validRpcRequest, headers: { cookie: "session=secret" } }),
    "RPC_HEADER_NOT_ALLOWED",
  );
  assertProtocolError(
    () => parseRelayMessage({ ...validRpcRequest, headers: { "x-internal-token": "secret" } }),
    "RPC_HEADER_NOT_ALLOWED",
  );
  assertProtocolError(
    () => parseRelayMessage({ ...validRpcRequest, body: "{\"deviceToken\":\"must-not-cross-relay\"}" }),
    "RPC_SENSITIVE_DATA_NOT_ALLOWED",
  );
  assertProtocolError(
    () => parseRelayMessage({ ...validRpcRequest, body: "{\"projectPath\":\"C:\\\\private\\\\project\"}" }),
    "RPC_PATH_NOT_ALLOWED",
  );
  assertProtocolError(
    () => parseRelayMessage({ ...validRpcResponse, body: "{\"project\":{\"path\":\"D:\\\\repo\"}}" }),
    "RPC_PATH_NOT_ALLOWED",
  );
  assert.equal(parseRelayMessage({
    ...validRpcResponse,
    body: "{\"file\":{\"path\":\"src/index.ts\"}}",
  }).type, "rpc.response");
  assertProtocolError(
    () => parseRelayMessage({ ...validRpcRequest, method: "GET", body: "{}" }),
    "INVALID_MESSAGE",
  );
});

test("RPC request and response body byte limits are enforced", () => {
  const exactRequest = {
    ...validRpcRequest,
    body: JSON.stringify("x".repeat(RELAY_RPC_REQUEST_BODY_MAX_BYTES - 2)),
  };
  assert.equal(parseRelayMessage(exactRequest).type, "rpc.request");
  assertProtocolError(() => parseRelayMessage(oversizedRequestBodyFixture), "RPC_BODY_TOO_LARGE");

  const exactResponse = {
    ...validRpcResponse,
    body: JSON.stringify("x".repeat(RELAY_RPC_RESPONSE_BODY_MAX_BYTES - 2)),
  };
  assert.equal(parseRelayMessage(exactResponse).type, "rpc.response");
  assertProtocolError(
    () => parseRelayMessage({ ...exactResponse, body: `${exactResponse.body}x` }),
    "RPC_RESPONSE_TOO_LARGE",
  );
  assertProtocolError(
    () => parseRelayMessage({ ...validRpcResponse, headers: { "set-cookie": "secret=1" } }),
    "RPC_HEADER_NOT_ALLOWED",
  );
});

test("requestId is idempotent per device and conflicting payloads are distinguishable", () => {
  assert.equal(classifyRpcRequest(undefined, validRpcRequest), "new");
  assert.equal(classifyRpcRequest(validRpcRequest, duplicateRpcRequestFixture), "replay");
  assert.equal(classifyRpcRequest(validRpcRequest, conflictingRpcRequestFixture), "conflict");
  assert.equal(
    classifyRpcRequest(validRpcRequest, { ...duplicateRpcRequestFixture, deviceId: "other-computer" }),
    "new",
  );
});

test("the first RPC response wins and duplicate or conflicting responses are classified", () => {
  assert.equal(classifyRpcResponse(undefined, validRpcResponse), "new");
  assert.equal(classifyRpcResponse(validRpcResponse, duplicateRpcResponseFixture), "duplicate");
  assert.equal(classifyRpcResponse(validRpcResponse, conflictingRpcResponseFixture), "conflict");
});

test("snapshot revisions accept only a newer complete snapshot after connection or reconnect", () => {
  assert.equal(classifySnapshotRevision(undefined, validSnapshot.revision), "new");
  assert.equal(classifySnapshotRevision(validSnapshot.revision, validSnapshot.revision), "duplicate");
  assert.equal(classifySnapshotRevision(validSnapshot.revision, staleSnapshotFixture.revision), "stale");
  assert.equal(classifySnapshotRevision(staleSnapshotFixture.revision, validSnapshot.revision), "new");
  assertProtocolError(
    () => parseRelayMessage({ ...validSnapshot, schemaVersion: "2.0" }),
    "INVALID_MESSAGE",
  );
  assertProtocolError(
    () => parseRelayMessage({ ...validSnapshot, snapshot: { connection: "online" } }),
    "INVALID_MESSAGE",
  );
});

test("normal and Harness RPC timeout, heartbeat, offline, and reconnect constants are frozen", () => {
  assert.equal(rpcTimeoutMsForPath("/api/state"), RELAY_RPC_DEFAULT_TIMEOUT_MS);
  assert.equal(rpcTimeoutMsForPath("/api/harness/chat"), RELAY_HARNESS_CHAT_TIMEOUT_MS);
  assert.equal(rpcTimeoutMsForPath("/api/harness/chat?deviceId=my-computer"), RELAY_HARNESS_CHAT_TIMEOUT_MS);
  assert.equal(RELAY_RPC_DEFAULT_TIMEOUT_MS, 45_000);
  assert.equal(RELAY_HARNESS_CHAT_TIMEOUT_MS, 120_000);
  assert.equal(RELAY_HEARTBEAT_INTERVAL_MS, 15_000);
  assert.equal(RELAY_OFFLINE_AFTER_MS, 45_000);
  assert.equal(RELAY_RECONNECT_INITIAL_MS, 500);
  assert.equal(RELAY_RECONNECT_MAX_MS, 8_000);
});

test("browser-visible errors use the stable structured envelope", () => {
  const timeout = createRelayErrorEnvelope(
    "RELAY_TIMEOUT",
    "Request timed out; execution status is unknown",
    { requestId: validRpcRequest.requestId, retryable: false },
  );
  assert.deepEqual(parseRelayErrorEnvelope(timeout), timeout);
  assert.deepEqual(timeout, {
    error: {
      code: "RELAY_TIMEOUT",
      message: "Request timed out; execution status is unknown",
      retryable: false,
      requestId: validRpcRequest.requestId,
    },
  });
  assertProtocolError(
    () => parseRelayErrorEnvelope({ ...timeout, token: "must-not-be-visible" }),
    "INVALID_MESSAGE",
  );
});

function assertProtocolError(operation: () => unknown, code: RelayErrorCode): void {
  assert.throws(operation, (error: unknown) => (
    error instanceof RelayProtocolError && error.code === code
  ));
}
