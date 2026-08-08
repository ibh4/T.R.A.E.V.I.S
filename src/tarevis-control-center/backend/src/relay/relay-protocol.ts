import {
  SCHEMA_VERSION,
  isControlCenterSnapshot,
  type ControlCenterSnapshot,
} from "../core/contracts.js";

export const RELAY_PROTOCOL_VERSION = 1 as const;
export const RELAY_PROTOCOL_MESSAGE_MAX_BYTES = 1_048_576;
export const RELAY_DEVICE_ID_MAX_LENGTH = 128;
export const RELAY_MESSAGE_ID_MAX_LENGTH = 128;
export const RELAY_AGENT_VERSION_MAX_LENGTH = 64;
export const RELAY_CONNECTION_ID_MAX_LENGTH = 128;
export const RELAY_PATH_MAX_LENGTH = 2_048;
export const RELAY_ERROR_MESSAGE_MAX_LENGTH = 512;
export const RELAY_HEADER_MAX_COUNT = 8;
export const RELAY_HEADER_VALUE_MAX_LENGTH = 4_096;
export const RELAY_RPC_REQUEST_BODY_MAX_BYTES = 65_536;
export const RELAY_RPC_RESPONSE_BODY_MAX_BYTES = 262_144;
export const RELAY_RPC_DEFAULT_TIMEOUT_MS = 45_000;
export const RELAY_HARNESS_CHAT_TIMEOUT_MS = 120_000;
export const RELAY_HEARTBEAT_INTERVAL_MS = 15_000;
export const RELAY_OFFLINE_AFTER_MS = 45_000;
export const RELAY_RECONNECT_INITIAL_MS = 500;
export const RELAY_RECONNECT_MAX_MS = 8_000;

export const RELAY_RPC_METHODS = ["GET", "POST", "PATCH", "DELETE"] as const;
export type RelayRpcMethod = typeof RELAY_RPC_METHODS[number];
export type RelayMessageType =
  | "agent.hello"
  | "agent.hello.ok"
  | "snapshot"
  | "rpc.request"
  | "rpc.response"
  | "heartbeat"
  | "heartbeat.ack"
  | "agent.error";

export const RELAY_REQUEST_HEADERS = ["accept", "content-type"] as const;
export const RELAY_RESPONSE_HEADERS = ["cache-control", "content-type", "etag", "last-modified"] as const;
export type RelayRequestHeaders = Partial<Record<typeof RELAY_REQUEST_HEADERS[number], string>>;
export type RelayResponseHeaders = Partial<Record<typeof RELAY_RESPONSE_HEADERS[number], string>>;

export const RELAY_ERROR_CODES = [
  "INVALID_JSON",
  "INVALID_MESSAGE",
  "MESSAGE_TOO_LARGE",
  "UNKNOWN_MESSAGE_TYPE",
  "UNSUPPORTED_PROTOCOL",
  "RPC_METHOD_NOT_ALLOWED",
  "RPC_PATH_NOT_ALLOWED",
  "RPC_HEADER_NOT_ALLOWED",
  "RPC_BODY_TOO_LARGE",
  "RPC_RESPONSE_TOO_LARGE",
  "RPC_SENSITIVE_DATA_NOT_ALLOWED",
  "RPC_REQUEST_ID_CONFLICT",
  "RPC_DUPLICATE_RESPONSE",
  "COMPUTER_OFFLINE",
  "RELAY_TIMEOUT",
  "INVALID_DEVICE",
  "DEVICE_NOT_FOUND",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "INTERNAL_ERROR",
] as const;
export type RelayErrorCode = typeof RELAY_ERROR_CODES[number];

export interface RelayMessageBase<TType extends RelayMessageType> {
  type: TType;
  protocolVersion: typeof RELAY_PROTOCOL_VERSION;
  deviceId: string;
  messageId: string;
  sentAt: string;
}

export interface AgentHelloMessage extends RelayMessageBase<"agent.hello"> {
  agentVersion: string;
  token: string;
}

export interface AgentHelloOkMessage extends RelayMessageBase<"agent.hello.ok"> {
  connectionId: string;
  ackForMessageId: string;
}

export interface RelaySnapshotMessage extends RelayMessageBase<"snapshot"> {
  schemaVersion: typeof SCHEMA_VERSION;
  revision: number;
  snapshot: ControlCenterSnapshot;
}

export interface RpcRequestMessage extends RelayMessageBase<"rpc.request"> {
  requestId: string;
  method: RelayRpcMethod;
  path: string;
  headers: RelayRequestHeaders;
  body?: string;
}

export interface RpcResponseMessage extends RelayMessageBase<"rpc.response"> {
  requestId: string;
  status: number;
  headers: RelayResponseHeaders;
  body: string;
}

export interface HeartbeatMessage extends RelayMessageBase<"heartbeat"> {}

export interface HeartbeatAckMessage extends RelayMessageBase<"heartbeat.ack"> {
  ackForMessageId: string;
}

export interface AgentErrorMessage extends RelayMessageBase<"agent.error"> {
  code: RelayErrorCode;
  message: string;
  retryable: boolean;
  requestId?: string;
}

export type RelayMessage =
  | AgentHelloMessage
  | AgentHelloOkMessage
  | RelaySnapshotMessage
  | RpcRequestMessage
  | RpcResponseMessage
  | HeartbeatMessage
  | HeartbeatAckMessage
  | AgentErrorMessage;

export interface RelayErrorEnvelope {
  error: {
    code: RelayErrorCode;
    message: string;
    retryable: boolean;
    requestId?: string;
  };
}

export type SnapshotRevisionDisposition = "new" | "duplicate" | "stale";
export type RpcRequestDisposition = "new" | "replay" | "conflict";
export type RpcResponseDisposition = "new" | "duplicate" | "conflict";

const relayErrorCodeSet = new Set<string>(RELAY_ERROR_CODES);
const relayRpcMethodSet = new Set<string>(RELAY_RPC_METHODS);
const requestHeaderSet = new Set<string>(RELAY_REQUEST_HEADERS);
const responseHeaderSet = new Set<string>(RELAY_RESPONSE_HEADERS);
const messageTypes = new Set<string>([
  "agent.hello",
  "agent.hello.ok",
  "snapshot",
  "rpc.request",
  "rpc.response",
  "heartbeat",
  "heartbeat.ack",
  "agent.error",
]);

export class RelayProtocolError extends Error {
  constructor(readonly code: RelayErrorCode, message: string) {
    super(message);
    this.name = "RelayProtocolError";
  }
}

export function parseRelayMessageJson(value: string): RelayMessage {
  if (byteLength(value) > RELAY_PROTOCOL_MESSAGE_MAX_BYTES) {
    throw new RelayProtocolError("MESSAGE_TOO_LARGE", "Relay message exceeds the maximum size");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new RelayProtocolError("INVALID_JSON", "Relay message must contain valid JSON");
  }
  return parseRelayMessage(parsed);
}

export function serializeRelayMessage(value: unknown): string {
  const message = parseRelayMessage(value);
  const serialized = JSON.stringify(message);
  if (byteLength(serialized) > RELAY_PROTOCOL_MESSAGE_MAX_BYTES) {
    throw new RelayProtocolError("MESSAGE_TOO_LARGE", "Relay message exceeds the maximum size");
  }
  return serialized;
}

export function parseRelayMessage(value: unknown): RelayMessage {
  const record = asRecord(value, "Relay message");
  const type = requiredString(record, "type", 1, 32);
  if (!messageTypes.has(type)) {
    throw new RelayProtocolError("UNKNOWN_MESSAGE_TYPE", `Unknown relay message type: ${type}`);
  }

  switch (type) {
    case "agent.hello":
      return parseAgentHello(record);
    case "agent.hello.ok":
      return parseAgentHelloOk(record);
    case "snapshot":
      return parseSnapshot(record);
    case "rpc.request":
      return parseRpcRequest(record);
    case "rpc.response":
      return parseRpcResponse(record);
    case "heartbeat":
      return parseHeartbeat(record);
    case "heartbeat.ack":
      return parseHeartbeatAck(record);
    case "agent.error":
      return parseAgentError(record);
  }
  throw new RelayProtocolError("UNKNOWN_MESSAGE_TYPE", `Unknown relay message type: ${type}`);
}

export function parseRelayErrorEnvelope(value: unknown): RelayErrorEnvelope {
  const record = asRecord(value, "Error envelope");
  assertKeys(record, ["error"]);
  const error = asRecord(record.error, "Error envelope error");
  assertKeys(error, ["code", "message", "retryable"], ["requestId"]);
  const code = parseErrorCode(error.code);
  const message = requiredString(error, "message", 1, RELAY_ERROR_MESSAGE_MAX_LENGTH);
  const retryable = requiredBoolean(error, "retryable");
  const requestId = optionalId(error, "requestId");
  return {
    error: {
      code,
      message,
      retryable,
      ...(requestId === undefined ? {} : { requestId }),
    },
  };
}

export function createRelayErrorEnvelope(
  code: RelayErrorCode,
  message: string,
  options: { retryable?: boolean; requestId?: string } = {},
): RelayErrorEnvelope {
  parseErrorCode(code);
  if (message.length === 0 || message.length > RELAY_ERROR_MESSAGE_MAX_LENGTH) {
    throw new RelayProtocolError("INVALID_MESSAGE", "Error message has an invalid length");
  }
  const requestId = options.requestId;
  if (requestId !== undefined) validateId(requestId, "requestId");
  return {
    error: {
      code,
      message,
      retryable: options.retryable ?? false,
      ...(requestId === undefined ? {} : { requestId }),
    },
  };
}

export function classifySnapshotRevision(
  currentRevision: number | undefined,
  incomingRevision: number,
): SnapshotRevisionDisposition {
  if (currentRevision === undefined || incomingRevision > currentRevision) return "new";
  if (incomingRevision === currentRevision) return "duplicate";
  return "stale";
}

export function classifyRpcRequest(
  existing: RpcRequestMessage | undefined,
  incoming: RpcRequestMessage,
): RpcRequestDisposition {
  if (!existing) return "new";
  if (existing.deviceId !== incoming.deviceId || existing.requestId !== incoming.requestId) return "new";
  return rpcRequestFingerprint(existing) === rpcRequestFingerprint(incoming) ? "replay" : "conflict";
}

export function classifyRpcResponse(
  existing: RpcResponseMessage | undefined,
  incoming: RpcResponseMessage,
): RpcResponseDisposition {
  if (!existing) return "new";
  if (existing.deviceId !== incoming.deviceId || existing.requestId !== incoming.requestId) return "new";
  return rpcResponseFingerprint(existing) === rpcResponseFingerprint(incoming) ? "duplicate" : "conflict";
}

export function rpcRequestFingerprint(message: RpcRequestMessage): string {
  return JSON.stringify({
    deviceId: message.deviceId,
    requestId: message.requestId,
    method: message.method,
    path: message.path,
    headers: sortHeaders(message.headers),
    body: message.body ?? null,
  });
}

export function rpcResponseFingerprint(message: RpcResponseMessage): string {
  return JSON.stringify({
    deviceId: message.deviceId,
    requestId: message.requestId,
    status: message.status,
    headers: sortHeaders(message.headers),
    body: message.body,
  });
}

export function rpcTimeoutMsForPath(path: string): number {
  const pathname = path.split("?", 1)[0];
  return pathname === "/api/harness/chat"
    ? RELAY_HARNESS_CHAT_TIMEOUT_MS
    : RELAY_RPC_DEFAULT_TIMEOUT_MS;
}

function parseAgentHello(record: Record<string, unknown>): AgentHelloMessage {
  assertKeys(record, ["type", "protocolVersion", "deviceId", "messageId", "sentAt", "agentVersion", "token"]);
  const base = parseBase(record, "agent.hello");
  const agentVersion = requiredString(record, "agentVersion", 1, RELAY_AGENT_VERSION_MAX_LENGTH);
  const token = requiredString(record, "token", 16, 512);
  return { ...base, type: "agent.hello", agentVersion, token };
}

function parseAgentHelloOk(record: Record<string, unknown>): AgentHelloOkMessage {
  assertKeys(record, ["type", "protocolVersion", "deviceId", "messageId", "sentAt", "connectionId", "ackForMessageId"]);
  const base = parseBase(record, "agent.hello.ok");
  const connectionId = requiredId(record, "connectionId", RELAY_CONNECTION_ID_MAX_LENGTH);
  const ackForMessageId = requiredId(record, "ackForMessageId", RELAY_MESSAGE_ID_MAX_LENGTH);
  return { ...base, type: "agent.hello.ok", connectionId, ackForMessageId };
}

function parseSnapshot(record: Record<string, unknown>): RelaySnapshotMessage {
  assertKeys(record, ["type", "protocolVersion", "deviceId", "messageId", "sentAt", "schemaVersion", "revision", "snapshot"]);
  const base = parseBase(record, "snapshot");
  if (record.schemaVersion !== SCHEMA_VERSION) {
    throw new RelayProtocolError("INVALID_MESSAGE", `Unsupported snapshot schemaVersion: ${String(record.schemaVersion)}`);
  }
  const revision = requiredNonNegativeInteger(record, "revision");
  if (!isControlCenterSnapshot(record.snapshot)) {
    throw new RelayProtocolError("INVALID_MESSAGE", "Snapshot does not satisfy the Control Center contract");
  }
  return {
    ...base,
    type: "snapshot",
    schemaVersion: SCHEMA_VERSION,
    revision,
    snapshot: structuredClone(record.snapshot),
  };
}

function parseRpcRequest(record: Record<string, unknown>): RpcRequestMessage {
  assertKeys(record, ["type", "protocolVersion", "deviceId", "messageId", "sentAt", "requestId", "method", "path", "headers"], ["body"]);
  const base = parseBase(record, "rpc.request");
  const requestId = requiredId(record, "requestId", RELAY_MESSAGE_ID_MAX_LENGTH);
  const method = requiredString(record, "method", 1, 8);
  if (!relayRpcMethodSet.has(method)) {
    throw new RelayProtocolError("RPC_METHOD_NOT_ALLOWED", `RPC method is not allowed: ${method}`);
  }
  const path = requiredString(record, "path", 1, RELAY_PATH_MAX_LENGTH);
  validateRpcPath(path);
  const headers = parseHeaders(record.headers, requestHeaderSet, "request");
  const body = parseBody(record.body, RELAY_RPC_REQUEST_BODY_MAX_BYTES, "RPC request body");
  validateRpcBodySafety(body, "request");
  if ((method === "GET" || method === "DELETE") && body !== undefined && body.length > 0) {
    throw new RelayProtocolError("INVALID_MESSAGE", `${method} RPC requests must not contain a body`);
  }
  return {
    ...base,
    type: "rpc.request",
    requestId,
    method: method as RelayRpcMethod,
    path,
    headers: headers as RelayRequestHeaders,
    ...(body === undefined ? {} : { body }),
  };
}

function parseRpcResponse(record: Record<string, unknown>): RpcResponseMessage {
  assertKeys(record, ["type", "protocolVersion", "deviceId", "messageId", "sentAt", "requestId", "status", "headers", "body"]);
  const base = parseBase(record, "rpc.response");
  const requestId = requiredId(record, "requestId", RELAY_MESSAGE_ID_MAX_LENGTH);
  const status = requiredInteger(record, "status");
  if (status < 100 || status > 599) {
    throw new RelayProtocolError("INVALID_MESSAGE", "RPC response status must be between 100 and 599");
  }
  const headers = parseHeaders(record.headers, responseHeaderSet, "response");
  const body = parseBody(record.body, RELAY_RPC_RESPONSE_BODY_MAX_BYTES, "RPC response body");
  validateRpcBodySafety(body, "response");
  return {
    ...base,
    type: "rpc.response",
    requestId,
    status,
    headers: headers as RelayResponseHeaders,
    body: body ?? "",
  };
}

function parseHeartbeat(record: Record<string, unknown>): HeartbeatMessage {
  assertKeys(record, ["type", "protocolVersion", "deviceId", "messageId", "sentAt"]);
  return { ...parseBase(record, "heartbeat"), type: "heartbeat" };
}

function parseHeartbeatAck(record: Record<string, unknown>): HeartbeatAckMessage {
  assertKeys(record, ["type", "protocolVersion", "deviceId", "messageId", "sentAt", "ackForMessageId"]);
  const base = parseBase(record, "heartbeat.ack");
  const ackForMessageId = requiredId(record, "ackForMessageId", RELAY_MESSAGE_ID_MAX_LENGTH);
  return { ...base, type: "heartbeat.ack", ackForMessageId };
}

function parseAgentError(record: Record<string, unknown>): AgentErrorMessage {
  assertKeys(record, ["type", "protocolVersion", "deviceId", "messageId", "sentAt", "code", "message", "retryable"], ["requestId"]);
  const base = parseBase(record, "agent.error");
  const code = parseErrorCode(record.code);
  const message = requiredString(record, "message", 1, RELAY_ERROR_MESSAGE_MAX_LENGTH);
  const retryable = requiredBoolean(record, "retryable");
  const requestId = optionalId(record, "requestId");
  return {
    ...base,
    type: "agent.error",
    code,
    message,
    retryable,
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function parseBase(record: Record<string, unknown>, type: string): Omit<RelayMessageBase<never>, "type"> {
  if (record.protocolVersion !== RELAY_PROTOCOL_VERSION) {
    throw new RelayProtocolError("UNSUPPORTED_PROTOCOL", `Unsupported relay protocol version: ${String(record.protocolVersion)}`);
  }
  const deviceId = requiredId(record, "deviceId", RELAY_DEVICE_ID_MAX_LENGTH);
  const messageId = requiredId(record, "messageId", RELAY_MESSAGE_ID_MAX_LENGTH);
  const sentAt = requiredString(record, "sentAt", 1, 64);
  if (!Number.isFinite(Date.parse(sentAt))) {
    throw new RelayProtocolError("INVALID_MESSAGE", `${type} sentAt must be an ISO timestamp`);
  }
  return { protocolVersion: RELAY_PROTOCOL_VERSION, deviceId, messageId, sentAt };
}

function parseHeaders(
  value: unknown,
  allowed: ReadonlySet<string>,
  direction: "request" | "response",
): Record<string, string> {
  const record = asRecord(value, `${direction} headers`);
  const result: Record<string, string> = {};
  const errorCode: RelayErrorCode = "RPC_HEADER_NOT_ALLOWED";
  if (Object.keys(record).length > RELAY_HEADER_MAX_COUNT) {
    throw new RelayProtocolError(errorCode, `${direction} headers exceed the maximum count`);
  }
  for (const [name, rawValue] of Object.entries(record)) {
    if (name !== name.toLowerCase() || !allowed.has(name)) {
      throw new RelayProtocolError(errorCode, `Header is not allowed: ${name}`);
    }
    if (typeof rawValue !== "string" || rawValue.length > RELAY_HEADER_VALUE_MAX_LENGTH || /[\r\n]/.test(rawValue)) {
      throw new RelayProtocolError(errorCode, `Invalid ${direction} header value: ${name}`);
    }
    result[name] = rawValue;
  }
  return result;
}

function parseBody(value: unknown, maximumBytes: number, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new RelayProtocolError("INVALID_MESSAGE", `${label} must be a string`);
  }
  if (byteLength(value) > maximumBytes) {
    throw new RelayProtocolError(
      maximumBytes === RELAY_RPC_REQUEST_BODY_MAX_BYTES ? "RPC_BODY_TOO_LARGE" : "RPC_RESPONSE_TOO_LARGE",
      `${label} exceeds ${maximumBytes} bytes`,
    );
  }
  return value;
}

function validateRpcPath(path: string): void {
  if (!path.startsWith("/api/") || path.includes("#") || path.includes("\\") || path.includes("://")) {
    throw new RelayProtocolError("RPC_PATH_NOT_ALLOWED", "RPC path must be a local /api/* path");
  }
  const rawPathname = path.split("?", 1)[0];
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(rawPathname);
  } catch {
    throw new RelayProtocolError("RPC_PATH_NOT_ALLOWED", "RPC path contains invalid escaping");
  }
  if (decodedPathname.includes("//") || decodedPathname.includes("\\") || decodedPathname.includes("\0")
    || decodedPathname.split("/").some((segment) => segment === "." || segment === "..")
    || /^(?:[a-z]:|file:)/i.test(decodedPathname)) {
    throw new RelayProtocolError("RPC_PATH_NOT_ALLOWED", "RPC path must not contain a filesystem path");
  }
  const rawQuery = path.includes("?") ? path.slice(path.indexOf("?") + 1) : "";
  let decodedQuery: string;
  try {
    decodedQuery = decodeURIComponent(rawQuery);
  } catch {
    throw new RelayProtocolError("RPC_PATH_NOT_ALLOWED", "RPC query contains invalid escaping");
  }
  if (decodedQuery.includes("\\") || /(?:^|&)(?:path|projectPath)=(?:[a-z]:|\/|file:)/i.test(decodedQuery)
    || /file:\/\/|https?:\/\//i.test(decodedQuery)) {
    throw new RelayProtocolError("RPC_PATH_NOT_ALLOWED", "RPC query must not contain an absolute local path or URL");
  }
}

function validateRpcBodySafety(body: string | undefined, direction: "request" | "response"): void {
  if (body === undefined || body.length === 0) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new RelayProtocolError("INVALID_MESSAGE", `RPC ${direction} body must contain valid JSON`);
  }
  visitJson(parsed, (key, value) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (["token", "devicetoken", "accesstoken", "authorization", "cookie", "apikey", "qwenapikey"]
      .includes(normalizedKey)) {
      throw new RelayProtocolError(
        "RPC_SENSITIVE_DATA_NOT_ALLOWED",
        `RPC ${direction} body contains a forbidden sensitive field: ${key}`,
      );
    }
    if (normalizedKey.endsWith("path") && typeof value === "string" && isAbsoluteLocalPath(value)) {
      throw new RelayProtocolError(
        "RPC_PATH_NOT_ALLOWED",
        `RPC ${direction} body must not contain an absolute local path`,
      );
    }
  });
}

function visitJson(value: unknown, visitor: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visitJson(item, visitor);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    visitor(key, item);
    visitJson(item, visitor);
  }
}

function isAbsoluteLocalPath(value: string): boolean {
  return /^[a-z]:[\\/]|^\\\\|^\/(?!api(?:\/|$))|^file:/i.test(value);
}

function parseErrorCode(value: unknown): RelayErrorCode {
  if (typeof value !== "string" || !relayErrorCodeSet.has(value)) {
    throw new RelayProtocolError("INVALID_MESSAGE", `Unknown relay error code: ${String(value)}`);
  }
  return value as RelayErrorCode;
}

function requiredId(record: Record<string, unknown>, key: string, maximumLength: number): string {
  const value = requiredString(record, key, 1, maximumLength);
  validateId(value, key);
  return value;
}

function optionalId(record: Record<string, unknown>, key: string): string | undefined {
  if (!(key in record)) return undefined;
  return requiredId(record, key, RELAY_MESSAGE_ID_MAX_LENGTH);
}

function validateId(value: string, key: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new RelayProtocolError("INVALID_MESSAGE", `${key} has an invalid format`);
  }
}

function requiredString(record: Record<string, unknown>, key: string, minimum: number, maximum: number): string {
  const value = record[key];
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) {
    throw new RelayProtocolError("INVALID_MESSAGE", `${key} must be a string of ${minimum}-${maximum} characters`);
  }
  return value;
}

function requiredBoolean(record: Record<string, unknown>, key: string): boolean {
  if (typeof record[key] !== "boolean") {
    throw new RelayProtocolError("INVALID_MESSAGE", `${key} must be a boolean`);
  }
  return record[key] as boolean;
}

function requiredInteger(record: Record<string, unknown>, key: string): number {
  if (typeof record[key] !== "number" || !Number.isSafeInteger(record[key])) {
    throw new RelayProtocolError("INVALID_MESSAGE", `${key} must be a safe integer`);
  }
  return record[key] as number;
}

function requiredNonNegativeInteger(record: Record<string, unknown>, key: string): number {
  const value = requiredInteger(record, key);
  if (value < 0) throw new RelayProtocolError("INVALID_MESSAGE", `${key} must not be negative`);
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RelayProtocolError("INVALID_MESSAGE", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!(key in record)) throw new RelayProtocolError("INVALID_MESSAGE", `Missing required field: ${key}`);
  }
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new RelayProtocolError("INVALID_MESSAGE", `Unknown field: ${key}`);
  }
}

function sortHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).sort(([left], [right]) => left.localeCompare(right)));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
