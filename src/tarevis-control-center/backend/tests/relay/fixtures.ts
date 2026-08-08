import { SCHEMA_VERSION } from "../../src/core/contracts.js";
import { createEmptySnapshot } from "../../src/core/snapshot-projector.js";
import {
  RELAY_PROTOCOL_VERSION,
  RELAY_RPC_REQUEST_BODY_MAX_BYTES,
  type AgentErrorMessage,
  type AgentHelloMessage,
  type AgentHelloOkMessage,
  type HeartbeatAckMessage,
  type HeartbeatMessage,
  type RelayMessage,
  type RelaySnapshotMessage,
  type RpcRequestMessage,
  type RpcResponseMessage,
} from "../../src/relay/relay-protocol.js";

export const FIXTURE_DEVICE_ID = "my-computer";
export const FIXTURE_SENT_AT = "2026-08-06T00:00:00.000Z";

export const validHello: AgentHelloMessage = {
  type: "agent.hello",
  protocolVersion: RELAY_PROTOCOL_VERSION,
  deviceId: FIXTURE_DEVICE_ID,
  messageId: "msg_hello_001",
  sentAt: FIXTURE_SENT_AT,
  agentVersion: "0.1.0",
  token: "fixture-token-value-with-32-bytes",
};

export const validHelloOk: AgentHelloOkMessage = {
  type: "agent.hello.ok",
  protocolVersion: RELAY_PROTOCOL_VERSION,
  deviceId: FIXTURE_DEVICE_ID,
  messageId: "msg_hello_ok_001",
  sentAt: FIXTURE_SENT_AT,
  connectionId: "conn_001",
  ackForMessageId: validHello.messageId,
};

export const validSnapshot: RelaySnapshotMessage = {
  type: "snapshot",
  protocolVersion: RELAY_PROTOCOL_VERSION,
  deviceId: FIXTURE_DEVICE_ID,
  messageId: "msg_snapshot_042",
  sentAt: FIXTURE_SENT_AT,
  schemaVersion: SCHEMA_VERSION,
  revision: 42,
  snapshot: createEmptySnapshot("live", "online", FIXTURE_SENT_AT),
};

export const validRpcRequest: RpcRequestMessage = {
  type: "rpc.request",
  protocolVersion: RELAY_PROTOCOL_VERSION,
  deviceId: FIXTURE_DEVICE_ID,
  messageId: "msg_rpc_request_001",
  sentAt: FIXTURE_SENT_AT,
  requestId: "req_browser_001",
  method: "POST",
  path: "/api/trae/commands",
  headers: {
    accept: "application/json",
    "content-type": "application/json",
  },
  body: "{}",
};

export const validRpcResponse: RpcResponseMessage = {
  type: "rpc.response",
  protocolVersion: RELAY_PROTOCOL_VERSION,
  deviceId: FIXTURE_DEVICE_ID,
  messageId: "msg_rpc_response_001",
  sentAt: FIXTURE_SENT_AT,
  requestId: validRpcRequest.requestId,
  status: 200,
  headers: {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  },
  body: "{}",
};

export const validHeartbeat: HeartbeatMessage = {
  type: "heartbeat",
  protocolVersion: RELAY_PROTOCOL_VERSION,
  deviceId: FIXTURE_DEVICE_ID,
  messageId: "msg_heartbeat_001",
  sentAt: FIXTURE_SENT_AT,
};

export const validHeartbeatAck: HeartbeatAckMessage = {
  type: "heartbeat.ack",
  protocolVersion: RELAY_PROTOCOL_VERSION,
  deviceId: FIXTURE_DEVICE_ID,
  messageId: "msg_heartbeat_ack_001",
  sentAt: FIXTURE_SENT_AT,
  ackForMessageId: validHeartbeat.messageId,
};

export const validAgentError: AgentErrorMessage = {
  type: "agent.error",
  protocolVersion: RELAY_PROTOCOL_VERSION,
  deviceId: FIXTURE_DEVICE_ID,
  messageId: "msg_error_001",
  sentAt: FIXTURE_SENT_AT,
  code: "RELAY_TIMEOUT",
  message: "The local backend response timed out; execution status is unknown",
  retryable: false,
  requestId: validRpcRequest.requestId,
};

export const validRelayMessages: RelayMessage[] = [
  validHello,
  validHelloOk,
  validSnapshot,
  validRpcRequest,
  validRpcResponse,
  validHeartbeat,
  validHeartbeatAck,
  validAgentError,
];

export const missingDeviceIdFixture = withoutKey(validHeartbeat, "deviceId");
export const unknownTypeFixture = { ...validHeartbeat, type: "relay.unknown" };
export const wrongVersionFixture = { ...validHeartbeat, protocolVersion: RELAY_PROTOCOL_VERSION + 1 };
export const oversizedRequestBodyFixture = {
  ...validRpcRequest,
  body: "x".repeat(RELAY_RPC_REQUEST_BODY_MAX_BYTES + 1),
};
export const forbiddenHeaderFixture = {
  ...validRpcRequest,
  headers: { authorization: "Bearer must-not-cross-relay" },
};
export const absoluteUrlFixture = {
  ...validRpcRequest,
  path: "https://127.0.0.1:8780/api/state",
};
export const duplicateRpcRequestFixture: RpcRequestMessage = {
  ...validRpcRequest,
  messageId: "msg_rpc_request_replay_001",
  sentAt: "2026-08-06T00:00:01.000Z",
};
export const conflictingRpcRequestFixture: RpcRequestMessage = {
  ...duplicateRpcRequestFixture,
  body: "{\"input\":\"different\"}",
};
export const duplicateRpcResponseFixture: RpcResponseMessage = {
  ...validRpcResponse,
  messageId: "msg_rpc_response_duplicate_001",
  sentAt: "2026-08-06T00:00:02.000Z",
};
export const conflictingRpcResponseFixture: RpcResponseMessage = {
  ...duplicateRpcResponseFixture,
  status: 500,
  body: "{\"error\":{\"code\":\"INTERNAL_ERROR\",\"message\":\"changed\"}}",
};
export const staleSnapshotFixture: RelaySnapshotMessage = {
  ...validSnapshot,
  messageId: "msg_snapshot_041",
  revision: 41,
};

function withoutKey<T extends Record<string, unknown>, TKey extends keyof T>(value: T, key: TKey): Omit<T, TKey> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}
