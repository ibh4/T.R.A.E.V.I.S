import type { TraeCommunicateConfig } from "../../config.js";
import type { ConnectionState } from "../../core/contracts.js";
import { noopLogger, type AppLogger } from "../../core/logger.js";
import type { CommandsService } from "../../modules/commands/commands-service.js";
import {
  COMMAND_RESULT_MAX_LENGTH,
  type CommandRecord,
  type CommandStatus,
} from "../../modules/commands/commands-types.js";
import {
  TRAE_BRIDGE_TIMEOUT_RESULT,
  TRAE_UNREAD_RESPONSE_RESULT,
} from "../../modules/trae/trae-types.js";
import {
  systemTimeoutScheduler,
  type TimeoutScheduler,
  type TraeAdapter,
} from "../../modules/trae/trae-adapter.js";

export const DEFAULT_BRIDGE_RESPONSE_MAX_BYTES = 65_536;
export { TRAE_BRIDGE_TIMEOUT_RESULT, TRAE_UNREAD_RESPONSE_RESULT } from "../../modules/trae/trae-types.js";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface LiveTraeAdapterConfig extends TraeCommunicateConfig {
  responseMaxBytes?: number;
}

export interface LiveTraeAdapterOptions {
  fetch?: FetchLike;
  scheduler?: TimeoutScheduler;
  logger?: AppLogger;
  nowMs?: () => number;
  startHealthPolling?: boolean;
  initialConnection?: ConnectionState;
}

interface QueuedCommand {
  command: CommandRecord;
  generation: number;
}

interface BridgeResponse {
  success: boolean;
  requestId: string;
  sent: boolean;
  strategy: string;
  message: string;
  response: {
    status: "read" | "unavailable" | "skipped";
    text?: string;
    reason?: string;
  };
  sentAt: string;
}

class BridgeProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BridgeProtocolError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) return value;
  return `${value.slice(0, Math.max(0, maximumLength - 3))}...`;
}

function sanitizeError(value: unknown): string {
  let message = value instanceof Error ? value.message : String(value ?? "Unknown Bridge error");
  const cwd = process.cwd();
  if (cwd) message = message.split(cwd).join("[local-path]");
  message = message
    .replace(/[A-Za-z]:\\(?:[^\\/\s:*?"<>|\r\n]+\\)*[^\\/\s:*?"<>|\r\n]*/g, "[local-path]")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(message || "Unknown Bridge error", COMMAND_RESULT_MAX_LENGTH);
}

async function readLimitedText(response: Response, maximumBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new BridgeProtocolError(`Bridge response exceeds ${maximumBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function readBridgeMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.message === "string" && value.message.trim()) return value.message.trim();
  if (isRecord(value.error)
    && typeof value.error.message === "string"
    && value.error.message.trim()) {
    return value.error.message.trim();
  }
  return undefined;
}

function parseBridgeResponse(value: unknown, expectedRequestId: string): BridgeResponse {
  if (!isRecord(value)) throw new BridgeProtocolError("Bridge response must be a JSON object");
  if (value.requestId !== expectedRequestId) {
    throw new BridgeProtocolError("Bridge response requestId does not match the command");
  }
  if (typeof value.success !== "boolean" || typeof value.sent !== "boolean") {
    throw new BridgeProtocolError("Bridge response must include boolean success and sent fields");
  }
  if (value.success !== value.sent) {
    throw new BridgeProtocolError("Bridge response success and sent fields are inconsistent");
  }
  if (typeof value.strategy !== "string" || !value.strategy.trim()
    || typeof value.message !== "string" || !value.message.trim()
    || typeof value.sentAt !== "string" || !Number.isFinite(Date.parse(value.sentAt))) {
    throw new BridgeProtocolError("Bridge response metadata is invalid");
  }
  if (!isRecord(value.response)
    || !["read", "unavailable", "skipped"].includes(String(value.response.status))) {
    throw new BridgeProtocolError("Bridge response status is invalid");
  }
  const status = value.response.status as BridgeResponse["response"]["status"];
  if (status === "read"
    && (typeof value.response.text !== "string" || !value.response.text.trim())) {
    throw new BridgeProtocolError("Bridge readable response is missing text");
  }
  return {
    success: value.success,
    requestId: value.requestId as string,
    sent: value.sent,
    strategy: value.strategy.trim(),
    message: value.message.trim(),
    response: {
      status,
      ...(typeof value.response.text === "string" ? { text: value.response.text } : {}),
      ...(typeof value.response.reason === "string" ? { reason: value.response.reason } : {}),
    },
    sentAt: value.sentAt,
  };
}

export class LiveTraeAdapter implements TraeAdapter {
  readonly adapterMode = "live" as const;
  private readonly fetchImpl: FetchLike;
  private readonly scheduler: TimeoutScheduler;
  private readonly logger: AppLogger;
  private readonly nowMs: () => number;
  private readonly responseMaxBytes: number;
  private readonly sendUrl: string;
  private readonly readyUrl: string;
  private readonly queue: QueuedCommand[] = [];
  private readonly connectionListeners = new Set<() => void>();
  private connection: ConnectionState;
  private commandGeneration = 0;
  private draining = false;
  private closed = false;
  private activeCommandController: AbortController | undefined;
  private activeCommandTimeout: unknown;
  private activeHealthController: AbortController | undefined;
  private activeHealthTimeout: unknown;
  private healthTimer: unknown;

  constructor(
    private readonly commands: CommandsService,
    private readonly config: LiveTraeAdapterConfig,
    options: LiveTraeAdapterOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch;
    this.scheduler = options.scheduler ?? systemTimeoutScheduler;
    this.logger = options.logger ?? noopLogger;
    this.nowMs = options.nowMs ?? Date.now;
    this.responseMaxBytes = config.responseMaxBytes ?? DEFAULT_BRIDGE_RESPONSE_MAX_BYTES;
    this.sendUrl = new URL("/send", `${config.url}/`).toString();
    this.readyUrl = new URL("/ready", `${config.url}/`).toString();
    this.connection = options.initialConnection ?? "offline";
    if (options.startHealthPolling !== false) void this.runHealthCheck();
  }

  execute(command: CommandRecord): void {
    if (this.closed) throw new Error("LiveTraeAdapter is closed");
    this.commands.transition(command.commandId, "accepted");
    this.queue.push({ command, generation: this.commandGeneration });
    this.logger.info("trae.bridge_command_accepted", {
      commandId: command.commandId,
      requestId: command.requestId,
      inputLength: command.input.length,
      queueLength: this.queue.length,
    });
    this.startDrain();
  }

  getConnection(): ConnectionState {
    return this.connection;
  }

  subscribeConnection(listener: () => void): () => void {
    if (this.closed) return () => undefined;
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  reset(): void {
    this.commandGeneration += 1;
    this.queue.length = 0;
    if (this.activeCommandTimeout !== undefined) this.scheduler.clear(this.activeCommandTimeout);
    this.activeCommandTimeout = undefined;
    this.activeCommandController?.abort();
    this.activeCommandController = undefined;
    this.logger.info("trae.bridge_adapter_reset", { generation: this.commandGeneration });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.reset();
    if (this.healthTimer !== undefined) this.scheduler.clear(this.healthTimer);
    this.healthTimer = undefined;
    if (this.activeHealthTimeout !== undefined) this.scheduler.clear(this.activeHealthTimeout);
    this.activeHealthTimeout = undefined;
    this.activeHealthController?.abort();
    this.activeHealthController = undefined;
    this.setConnection("offline");
    this.connectionListeners.clear();
  }

  private startDrain(): void {
    if (this.closed || this.draining || this.queue.length === 0) return;
    this.draining = true;
    const generation = this.commandGeneration;
    void this.drainQueue(generation);
  }

  private async drainQueue(generation: number): Promise<void> {
    try {
      while (!this.closed && generation === this.commandGeneration && this.queue.length > 0) {
        const queued = this.queue.shift();
        if (!queued || queued.generation !== generation) continue;
        if (!this.hasStatus(queued.command.commandId, "accepted")) continue;
        this.commands.transition(queued.command.commandId, "running");
        await this.sendCommand(queued.command, generation);
      }
    } finally {
      this.draining = false;
      if (!this.closed && this.queue.length > 0) this.startDrain();
    }
  }

  private async sendCommand(command: CommandRecord, generation: number): Promise<void> {
    const started = this.nowMs();
    const controller = new AbortController();
    this.activeCommandController = controller;
    let timedOut = false;
    const timeoutHandle = this.scheduler.set(() => {
      timedOut = true;
      controller.abort();
    }, this.config.timeoutMs);
    this.activeCommandTimeout = timeoutHandle;
    this.logger.info("trae.bridge_command_started", {
      commandId: command.commandId,
      requestId: command.requestId,
      inputLength: command.input.length,
    });

    let terminalStatus: "succeeded" | "failed" | "expired" = "failed";
    let result = "TRAE Bridge 调用失败。";
    try {
      const response = await this.fetchImpl(this.sendUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ requestId: command.requestId, text: command.input }),
        signal: controller.signal,
      });
      const text = await readLimitedText(response, this.responseMaxBytes);
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new BridgeProtocolError("Bridge returned invalid JSON");
      }
      if (!response.ok) {
        const detail = readBridgeMessage(payload);
        throw new Error(`Bridge returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
      }
      const bridge = parseBridgeResponse(payload, command.requestId);
      if (!bridge.success || !bridge.sent) {
        throw new Error(bridge.message || "Bridge did not confirm prompt delivery");
      }
      terminalStatus = "succeeded";
      result = bridge.response.status === "read"
        ? truncate(bridge.response.text!.trim(), COMMAND_RESULT_MAX_LENGTH)
        : TRAE_UNREAD_RESPONSE_RESULT;
    } catch (error) {
      if (timedOut) {
        terminalStatus = "expired";
        result = TRAE_BRIDGE_TIMEOUT_RESULT;
      } else {
        terminalStatus = "failed";
        result = sanitizeError(error);
      }
    } finally {
      this.scheduler.clear(timeoutHandle);
      if (this.activeCommandTimeout === timeoutHandle) this.activeCommandTimeout = undefined;
      if (this.activeCommandController === controller) this.activeCommandController = undefined;
    }

    if (this.closed || generation !== this.commandGeneration) return;
    if (!this.hasStatus(command.commandId, "running")) return;
    this.commands.transition(command.commandId, terminalStatus, result);
    this.logger.info("trae.bridge_command_completed", {
      commandId: command.commandId,
      requestId: command.requestId,
      durationMs: Math.max(0, this.nowMs() - started),
      status: terminalStatus,
    });
  }

  private hasStatus(commandId: string, status: CommandStatus): boolean {
    try {
      return this.commands.get(commandId).status === status;
    } catch {
      return false;
    }
  }

  private async runHealthCheck(): Promise<void> {
    if (this.closed) return;
    const controller = new AbortController();
    this.activeHealthController = controller;
    const timeoutMs = Math.min(this.config.timeoutMs, this.config.healthIntervalMs);
    const timeoutHandle = this.scheduler.set(() => controller.abort(), timeoutMs);
    this.activeHealthTimeout = timeoutHandle;
    let nextConnection: ConnectionState = "offline";
    let bridgeReached = false;
    try {
      const response = await this.fetchImpl(this.readyUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      bridgeReached = true;
      const text = await readLimitedText(response, this.responseMaxBytes);
      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        throw new BridgeProtocolError("Bridge readiness returned invalid JSON");
      }
      nextConnection = response.ok
        && isRecord(payload)
        && payload.success === true
        && payload.ready === true
        ? "online"
        : "degraded";
    } catch (error) {
      nextConnection = bridgeReached ? "degraded" : "offline";
      this.logger.debug("trae.bridge_health_failed", { error: sanitizeError(error) });
    } finally {
      this.scheduler.clear(timeoutHandle);
      if (this.activeHealthTimeout === timeoutHandle) this.activeHealthTimeout = undefined;
      if (this.activeHealthController === controller) this.activeHealthController = undefined;
    }
    if (this.closed) return;
    this.setConnection(nextConnection);
    this.healthTimer = this.scheduler.set(() => {
      this.healthTimer = undefined;
      void this.runHealthCheck();
    }, this.config.healthIntervalMs);
  }

  private setConnection(connection: ConnectionState): void {
    if (this.connection === connection) return;
    const previous = this.connection;
    this.connection = connection;
    this.logger.info("trae.bridge_connection_changed", { previous, connection });
    for (const listener of this.connectionListeners) listener();
  }
}
