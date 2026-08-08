import emptySnapshotFixture from "../../backend/data/empty-snapshot.json";
import { parseSnapshotEnvelope, parseSnapshotMessage } from "./contract";
import { controlCenterHttpUrl, controlCenterWebSocketUrl } from "./endpoints";
import { initialMockSnapshot } from "./mock-data";
import type {
  AdapterConnectionStatus,
  CommandRecord,
  ControlCenterSnapshot,
  RobotCommandRequest,
  SubmitCommandInput,
} from "./types";

type SnapshotListener = (
  snapshot: ControlCenterSnapshot,
  status: AdapterConnectionStatus,
) => void;

type RelayErrorCode = "COMPUTER_OFFLINE" | "RELAY_TIMEOUT" | "INVALID_DEVICE" | "UNAUTHORIZED" | string;

class RelayApiError extends Error {
  constructor(
    readonly code: RelayErrorCode,
    readonly status: number,
    readonly retryable: boolean,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "RelayApiError";
  }
}

const configuredDeviceId = import.meta.env.VITE_CONTROL_CENTER_DEVICE_ID?.trim() || "my-computer";

function relayErrorText(code: RelayErrorCode | undefined, fallback: string): string {
  switch (code) {
    case "COMPUTER_OFFLINE": return "本地电脑离线，当前不能执行命令。";
    case "RELAY_TIMEOUT": return "请求超时，执行结果未知，请检查状态后再重试。";
    case "INVALID_DEVICE": return "当前设备配置无效，请检查 deviceId。";
    case "UNAUTHORIZED": return "Cloudflare Access 未认证，请重新登录。";
    default: return fallback;
  }
}

export interface ControlCenterAdapter {
  getSnapshot(): ControlCenterSnapshot;
  getStatus(): AdapterConnectionStatus;
  subscribe(listener: SnapshotListener): () => void;
  acknowledgeEvent(eventId: string): Promise<void>;
  resolveEvent(eventId: string): Promise<void>;
  submitCommand(input: SubmitCommandInput): Promise<string>;
  submitRobotCommand(input: RobotCommandRequest): Promise<string>;
  emergencyStopRobot(requestId?: string): Promise<string>;
  resetDemo(): Promise<void>;
}

const robotMotionActions = new Set<RobotCommandRequest["action"]>([
  "forward", "backward", "turn_left", "turn_right", "patrol", "return_home",
]);

function robotCommandLabel(input: RobotCommandRequest): string {
  switch (input.action) {
    case "forward": return `机器人前进 ${input.params.distanceCm} 厘米`;
    case "backward": return `机器人后退 ${input.params.distanceCm} 厘米`;
    case "turn_left": return `机器人向左转 ${input.params.angleDeg} 度`;
    case "turn_right": return `机器人向右转 ${input.params.angleDeg} 度`;
    case "patrol": return "开始安全区域巡逻";
    case "return_home": return "返回安全待命点";
    case "stop": return "停止当前运动";
  }
}

function cloneSnapshot(snapshot: ControlCenterSnapshot): ControlCenterSnapshot {
  return structuredClone(snapshot);
}

export class MockControlCenterAdapter implements ControlCenterAdapter {
  private snapshot = cloneSnapshot(initialMockSnapshot);
  private readonly status: AdapterConnectionStatus = {
    phase: "online",
    message: "浏览器 Mock Adapter 已连接。",
    deviceId: configuredDeviceId,
    revision: null,
    lastSeenAt: null,
    canExecute: true,
  };
  private readonly listeners = new Set<SnapshotListener>();
  private timerGeneration = 0;

  getSnapshot(): ControlCenterSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  getStatus(): AdapterConnectionStatus {
    return { ...this.status, lastSeenAt: this.snapshot.lastSyncedAt };
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot(), this.getStatus());
    return () => this.listeners.delete(listener);
  }

  async acknowledgeEvent(eventId: string): Promise<void> {
    const generation = this.timerGeneration;
    await new Promise((resolve) => window.setTimeout(resolve, 260));
    if (generation !== this.timerGeneration) throw new Error("演示状态已重置，请重试操作。");
    const event = this.snapshot.events.find((item) => item.eventId === eventId);
    if (!event) {
      throw new Error(`Event not found: ${eventId}`);
    }

    if (event.state !== "detected") throw new Error(`事件当前状态无法确认：${event.state}`);
    const acknowledgedAt = new Date().toISOString();
    event.state = "acknowledged";
    event.acknowledgedAt = acknowledgedAt;
    event.acknowledgedBy = "local-demo-user";
    event.updatedAt = acknowledgedAt;
    this.deriveHomeStatus();
    this.touch();
  }

  async resolveEvent(eventId: string): Promise<void> {
    const generation = this.timerGeneration;
    await new Promise((resolve) => window.setTimeout(resolve, 260));
    if (generation !== this.timerGeneration) throw new Error("演示状态已重置，请重试操作。");
    const event = this.snapshot.events.find((item) => item.eventId === eventId);
    if (!event) throw new Error(`Event not found: ${eventId}`);
    if (event.state !== "acknowledged" && event.state !== "escalated") {
      throw new Error(`事件当前状态无法解决：${event.state}`);
    }
    const resolvedAt = new Date().toISOString();
    event.state = "resolved";
    event.resolvedAt = resolvedAt;
    event.resolvedBy = "local-demo-user";
    event.updatedAt = resolvedAt;
    this.deriveHomeStatus();
    this.touch();
  }

  async submitCommand(input: SubmitCommandInput): Promise<string> {
    if (input.target !== "trae") {
      throw new Error("全局文本命令当前只支持 TRAE。");
    }
    const normalized = input.input.trim();
    if (!normalized) {
      throw new Error("Command input cannot be empty");
    }

    const requestId = input.requestId ?? `req_browser_${crypto.randomUUID()}`;
    const existing = this.snapshot.commands.find((command) => command.requestId === requestId);
    if (existing) return existing.commandId;
    const commandId = `cmd_mock_${crypto.randomUUID()}`;
    const requestedAt = new Date().toISOString();
    const command: CommandRecord = {
      commandId,
      requestId,
      target: input.target,
      input: normalized,
      status: "requested",
      requestedAt,
      updatedAt: requestedAt,
      adapterMode: "mock",
    };
    this.snapshot.commands.unshift(command);
    this.updateTargetState(input.target, "requested", normalized);
    this.touch();

    this.schedule(() => this.progressCommand(commandId, "accepted"), 360);
    this.schedule(() => this.progressCommand(commandId, "running"), 900);
    this.schedule(() => this.progressCommand(commandId, "succeeded"), 2_300);
    return commandId;
  }

  async submitRobotCommand(input: RobotCommandRequest): Promise<string> {
    if (robotMotionActions.has(input.action) && input.confirmed !== true) {
      throw new Error(`${input.action} requires confirmed: true`);
    }
    if ((input.action === "forward" || input.action === "backward")
      && (!Number.isInteger(input.params.distanceCm) || input.params.distanceCm! < 1 || input.params.distanceCm! > 100)) {
      throw new Error("distanceCm must be an integer from 1 to 100");
    }
    if ((input.action === "turn_left" || input.action === "turn_right")
      && (!Number.isInteger(input.params.angleDeg) || input.params.angleDeg! < 1 || input.params.angleDeg! > 180)) {
      throw new Error("angleDeg must be an integer from 1 to 180");
    }
    return this.createMockRobotCommand(robotCommandLabel(input), input.requestId);
  }

  async emergencyStopRobot(requestId = `req_browser_${crypto.randomUUID()}`): Promise<string> {
    const existing = this.snapshot.commands.find((command) => command.requestId === requestId);
    if (existing) return existing.commandId;
    const updatedAt = new Date().toISOString();
    for (const command of this.snapshot.commands) {
      if (command.target === "robot" && ["requested", "accepted", "running"].includes(command.status)) {
        command.status = "failed";
        command.result = "动作已由紧急停止中断。";
        command.updatedAt = updatedAt;
      }
    }
    const commandId = `cmd_mock_${crypto.randomUUID()}`;
    this.snapshot.commands.unshift({
      commandId,
      requestId,
      target: "robot",
      input: "停止所有运动（急停）",
      status: "succeeded",
      requestedAt: updatedAt,
      updatedAt,
      result: "浏览器 Mock Robot 已确认所有运动输出停止。",
      adapterMode: "mock",
    });
    this.snapshot.robot = {
      ...this.snapshot.robot,
      state: "standby",
      label: "紧急停止",
      task: "浏览器 Mock Robot 已确认所有运动输出停止。",
      updatedAt,
    };
    this.touch();
    return commandId;
  }

  async resetDemo(): Promise<void> {
    this.timerGeneration += 1;
    this.snapshot = cloneSnapshot(initialMockSnapshot);
    this.snapshot.lastSyncedAt = new Date().toISOString();
    this.notify();
  }

  private createMockRobotCommand(input: string, requestId = `req_browser_${crypto.randomUUID()}`): string {
    const existing = this.snapshot.commands.find((command) => command.requestId === requestId);
    if (existing) return existing.commandId;
    const commandId = `cmd_mock_${crypto.randomUUID()}`;
    const requestedAt = new Date().toISOString();
    this.snapshot.commands.unshift({
      commandId,
      requestId,
      target: "robot",
      input,
      status: "requested",
      requestedAt,
      updatedAt: requestedAt,
      adapterMode: "mock",
    });
    this.updateTargetState("robot", "requested", input);
    this.touch();
    this.schedule(() => this.progressCommand(commandId, "accepted"), 260);
    this.schedule(() => this.progressCommand(commandId, "running"), 620);
    this.schedule(() => this.progressCommand(commandId, "succeeded"), 1_500);
    return commandId;
  }

  private progressCommand(commandId: string, status: CommandRecord["status"]): void {
    const command = this.snapshot.commands.find((item) => item.commandId === commandId);
    if (!command) return;
    const expectedPrevious: Partial<Record<CommandRecord["status"], CommandRecord["status"]>> = {
      accepted: "requested",
      running: "accepted",
      succeeded: "running",
    };
    if (command.status !== expectedPrevious[status]) return;
    command.status = status;
    command.updatedAt = new Date().toISOString();
    if (status === "succeeded") {
      command.result = command.target === "trae"
        ? "Mock TRAE 已返回可读回复。"
        : "Mock adapter 已返回成功回执";
    }
    this.updateTargetState(command.target, status, command.input);
    this.touch();
  }

  private updateTargetState(
    target: CommandRecord["target"],
    status: CommandRecord["status"],
    input: string,
  ): void {
    const updatedAt = new Date().toISOString();
    if (target === "robot") {
      this.snapshot.robot = {
        ...this.snapshot.robot,
        state: status === "succeeded" ? "standby" : "executing",
        label: status === "succeeded" ? "待命" : "执行中",
        task: status === "succeeded" ? "命令执行完成，等待下一条指令" : input,
        updatedAt,
      };
    }
    if (target === "trae") {
      const labels: Partial<Record<CommandRecord["status"], string>> = {
        requested: "已请求",
        accepted: "已进入本地队列",
        running: "正在投递",
        succeeded: "已读取回复",
      };
      this.snapshot.trae = {
        ...this.snapshot.trae,
        state: status === "succeeded" ? "idle" : "working",
        label: labels[status] ?? "发送失败",
        task: input,
        progress: status === "requested" ? 8 : status === "accepted" ? 24 : status === "running" ? 72 : 100,
        suggestion: status === "succeeded"
          ? "Mock TRAE 已返回可读回复。"
          : status === "running"
            ? "正在投递指令并等待结果。"
            : "指令已进入本地发送流程。",
        updatedAt,
      };
    }
  }

  private touch(): void {
    this.deriveDiagnostics();
    this.snapshot.lastSyncedAt = new Date().toISOString();
    this.notify();
  }

  private deriveDiagnostics(): void {
    const unresolved = this.snapshot.events.filter((event) => event.state !== "resolved");
    const critical = unresolved.filter((event) => event.level === "critical").length;
    const warning = unresolved.filter((event) => event.level === "warning").length;
    const alerts = this.snapshot.resources.find((resource) => resource.id === "alerts");
    if (alerts) {
      alerts.value = Math.min(100, critical * 50 + warning * 25);
      alerts.displayValue = critical > 0
        ? `${critical} CRITICAL`
        : warning > 0
          ? `${warning} WARNING`
          : "0 ACTIVE";
      alerts.tone = critical > 0 ? "red" : warning > 0 ? "yellow" : "green";
      alerts.history = [...alerts.history.slice(-6), alerts.value];
    }
  }

  private deriveHomeStatus(): void {
    const unresolved = this.snapshot.events.filter((event) => event.state !== "resolved");
    const emergency = unresolved.find(
      (event) => event.level === "critical" && (event.state === "detected" || event.state === "escalated"),
    );
    const attention = unresolved.find((event) => event.level === "critical" || event.level === "warning");
    const updatedAt = new Date().toISOString();
    if (emergency) {
      this.snapshot.home = {
        state: "emergency",
        label: emergency.state === "escalated" ? "已升级" : "紧急告警",
        summary: `${emergency.zone}的${emergency.title}等待处理。`,
        activeZone: emergency.zone,
        updatedAt,
      };
    } else if (attention) {
      this.snapshot.home = {
        state: "attention",
        label: "需要关注",
        summary: attention.state === "acknowledged"
          ? `${attention.zone}的${attention.title}已确认，等待解决。`
          : `${attention.zone}的${attention.title}等待处理。`,
        activeZone: attention.zone,
        updatedAt,
      };
    } else {
      this.snapshot.home = {
        state: "normal",
        label: "状态正常",
        summary: "当前没有未解决的警告或紧急家庭事件。",
        activeZone: "--",
        updatedAt,
      };
    }
  }

  private notify(): void {
    const nextSnapshot = this.getSnapshot();
    const nextStatus = this.getStatus();
    this.listeners.forEach((listener) => listener(nextSnapshot, nextStatus));
  }

  private schedule(callback: () => void, delayMs: number): void {
    const generation = this.timerGeneration;
    window.setTimeout(() => {
      if (generation === this.timerGeneration) callback();
    }, delayMs);
  }
}

export class LiveControlCenterAdapter implements ControlCenterAdapter {
  private snapshot = cloneSnapshot(emptySnapshotFixture as ControlCenterSnapshot);
  private status: AdapterConnectionStatus = {
    phase: "loading",
    message: "正在连接 Control Center 后端...",
    deviceId: configuredDeviceId,
    revision: null,
    lastSeenAt: null,
    canExecute: false,
  };
  private revision = -1;
  private started = false;
  private connecting = false;
  private hasValidSnapshot = false;
  private reconnectAttempt = 0;
  private reconnectTimer: number | null = null;
  private lifecycle = 0;
  private connectionCycle = 0;
  private socket: WebSocket | null = null;
  private metadataTimer: number | null = null;
  private readonly listeners = new Set<SnapshotListener>();

  constructor(
    private readonly apiBase = "/",
    private readonly deviceId = configuredDeviceId,
  ) {
    this.status = {
      ...this.status,
      deviceId,
    };
  }

  getSnapshot(): ControlCenterSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  getStatus(): AdapterConnectionStatus {
    return { ...this.status };
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot(), this.getStatus());
    if (!this.started) {
      this.started = true;
      this.lifecycle += 1;
      void this.connect(this.lifecycle);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  async acknowledgeEvent(eventId: string): Promise<void> {
    await this.requestEventAction(eventId, "ack");
  }

  async resolveEvent(eventId: string): Promise<void> {
    await this.requestEventAction(eventId, "resolve");
  }

  async submitCommand(input: SubmitCommandInput): Promise<string> {
    if (input.target !== "trae") {
      throw new Error("全局文本命令当前只支持 TRAE。");
    }
    const response = await this.request(this.httpUrl("api/trae/commands"), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        requestId: input.requestId ?? `req_browser_${crypto.randomUUID()}`,
        input: input.input,
      }),
    });
    if (!response.ok) {
      throw await this.apiError(response, `TRAE 命令提交失败（HTTP ${response.status}）。`);
    }
    const body = await response.json() as { command?: { commandId?: unknown } };
    if (typeof body.command?.commandId !== "string") {
      throw new Error("TRAE 命令接口返回了不兼容的响应。");
    }
    await this.refreshSnapshotAfterWrite();
    return body.command.commandId;
  }

  async submitRobotCommand(input: RobotCommandRequest): Promise<string> {
    return this.requestRobotCommand("api/robot/commands", {
      ...input,
      requestId: input.requestId ?? `req_browser_${crypto.randomUUID()}`,
    }, "机器人动作提交失败");
  }

  async emergencyStopRobot(requestId = `req_browser_${crypto.randomUUID()}`): Promise<string> {
    return this.requestRobotCommand(
      "api/robot/emergency-stop",
      { requestId },
      "机器人急停失败",
    );
  }

  async resetDemo(): Promise<void> {
    const response = await this.request(this.httpUrl("api/demo/reset"), {
      method: "POST",
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw await this.apiError(response, `演示重置失败（HTTP ${response.status}）。`);
    }
    this.acceptEnvelope(
      parseSnapshotEnvelope(await response.json()),
      true,
      this.status.phase !== "online",
    );
  }

  private async connect(lifecycle: number): Promise<void> {
    if (this.connecting || !this.started || lifecycle !== this.lifecycle) return;
    this.connecting = true;
    try {
      const response = await this.request(this.httpUrl("api/state"), {
        headers: { accept: "application/json", "cache-control": "no-store" },
      });
      if (!response.ok) {
        throw await this.apiError(response, `后端状态请求失败（HTTP ${response.status}）。`);
      }
      const envelope = parseSnapshotEnvelope(await response.json());
      if (!this.started || lifecycle !== this.lifecycle) return;
      this.acceptEnvelope(envelope, false, true);
      await this.refreshDeviceMetadata(lifecycle);
      this.openWebSocket(lifecycle);
    } catch (error) {
      if (!this.started || lifecycle !== this.lifecycle) return;
      if (error instanceof RelayApiError && error.code === "UNAUTHORIZED") {
        this.setDisconnected("auth-error", relayErrorText(error.code, error.message), error.code);
      } else if (error instanceof RelayApiError && error.code === "INVALID_DEVICE") {
        this.setDisconnected("protocol-error", relayErrorText(error.code, error.message), error.code);
      } else if (this.isProtocolError(error)) {
        this.setDisconnected("protocol-error", this.errorMessage(error));
      } else {
        const code = error instanceof RelayApiError ? error.code : "COMPUTER_OFFLINE";
        this.setDisconnected("offline", relayErrorText(code, this.errorMessage(error, "Control Center 后端离线。")), code);
        this.scheduleReconnect(lifecycle);
      }
    } finally {
      this.connecting = false;
    }
  }

  private async requestEventAction(eventId: string, action: "ack" | "resolve"): Promise<void> {
    const response = await this.request(this.httpUrl(`api/events/${encodeURIComponent(eventId)}/${action}`), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({}),
    });
    if (response.ok) {
      await this.refreshSnapshotAfterWrite();
      return;
    }

    const fallback = `事件${action === "ack" ? "确认" : "解决"}失败（HTTP ${response.status}）。`;
    throw await this.apiError(response, fallback);
  }

  private async requestRobotCommand(path: string, body: unknown, fallback: string): Promise<string> {
    const response = await this.request(this.httpUrl(path), {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw await this.apiError(response, `${fallback}（HTTP ${response.status}）。`);
    }
    const responseBody = await response.json() as { command?: { commandId?: unknown } };
    if (typeof responseBody.command?.commandId !== "string") {
      throw new Error("机器人命令接口返回了不兼容的响应。");
    }
    await this.refreshSnapshotAfterWrite();
    return responseBody.command.commandId;
  }

  private async refreshSnapshotAfterWrite(): Promise<void> {
    const connectionCycle = this.connectionCycle;
    try {
      const response = await this.request(this.httpUrl("api/state"), {
        headers: { accept: "application/json" },
      });
      if (response.ok && connectionCycle === this.connectionCycle) {
        this.acceptEnvelope(parseSnapshotEnvelope(await response.json()));
      }
    } catch {
      // An established websocket may already have delivered this revision.
    }
  }

  private async apiError(response: Response, fallback: string): Promise<RelayApiError> {
    let code: RelayErrorCode = "HTTP_ERROR";
    let retryable = response.status >= 500;
    let requestId: string | undefined;
    let serverMessage = fallback;
    try {
      const body = await response.json() as {
        error?: { code?: unknown; message?: unknown; retryable?: unknown; requestId?: unknown };
      };
      if (typeof body.error?.code === "string") code = body.error.code;
      if (typeof body.error?.message === "string") serverMessage = body.error.message;
      if (typeof body.error?.retryable === "boolean") retryable = body.error.retryable;
      if (typeof body.error?.requestId === "string") requestId = body.error.requestId;
    } catch {
      // Keep the HTTP status fallback when the response is not JSON.
    }
    const error = new RelayApiError(code, response.status, retryable, relayErrorText(code, serverMessage), requestId);
    this.reflectApiError(error);
    return error;
  }

  private openWebSocket(lifecycle: number): void {
    const socket = new WebSocket(this.webSocketUrl());
    this.socket = socket;
    socket.addEventListener("open", () => {
      if (this.socket !== socket || lifecycle !== this.lifecycle) return;
      this.reconnectAttempt = 0;
      this.status = {
        ...this.status,
        phase: "online",
        message: `后端已连接，revision ${this.revision}。`,
        canExecute: true,
        errorCode: undefined,
      };
      this.startMetadataPolling(lifecycle);
      this.notify();
    });
    socket.addEventListener("message", (event) => {
      try {
        const raw = typeof event.data === "string" ? event.data : "";
        this.acceptEnvelope(parseSnapshotMessage(JSON.parse(raw)));
      } catch (error) {
        this.setDisconnected("protocol-error", this.errorMessage(error));
        socket.close(1002, "Protocol error");
      }
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (this.status.phase === "protocol-error" || this.status.phase === "auth-error") {
        this.stopMetadataPolling();
        return;
      }
      this.connectionCycle += 1;
      this.stopMetadataPolling();
      this.setDisconnected("offline", "与 Control Center 后端的实时连接已断开。", "COMPUTER_OFFLINE");
      this.scheduleReconnect(lifecycle);
    });
    socket.addEventListener("error", () => {
      if (this.status.phase !== "protocol-error") {
        this.setDisconnected("offline", "无法建立 Control Center 实时连接。", "COMPUTER_OFFLINE");
      }
    });
  }

  private acceptEnvelope(
    envelope: { revision: number; snapshot: ControlCenterSnapshot },
    markOnline = true,
    allowRevisionReset = false,
  ): void {
    if (!allowRevisionReset && envelope.revision < this.revision) return;
    this.revision = envelope.revision;
    this.snapshot = cloneSnapshot(envelope.snapshot);
    this.hasValidSnapshot = true;
    const device = this.snapshot.devices.find((candidate) => candidate.deviceId === this.deviceId);
    if (device && Number.isFinite(Date.parse(device.lastSeen))) {
      this.status = { ...this.status, lastSeenAt: device.lastSeen };
    }
    if (markOnline) {
      this.status = {
        ...this.status,
        phase: "online",
        message: `后端已连接，revision ${this.revision}。`,
        revision: this.revision,
        canExecute: true,
        errorCode: undefined,
      };
    } else {
      this.status = { ...this.status, revision: this.revision };
    }
    this.notify();
  }

  private setDisconnected(
    phase: Extract<AdapterConnectionStatus["phase"], "offline" | "protocol-error" | "auth-error">,
    message: string,
    errorCode?: string,
  ): void {
    this.snapshot = {
      ...this.snapshot,
      connection: phase === "protocol-error" || !this.hasValidSnapshot ? "offline" : "degraded",
    };
    this.status = { ...this.status, phase, message, canExecute: false, errorCode };
    this.notify();
  }

  private scheduleReconnect(lifecycle: number): void {
    if (!this.started
      || lifecycle !== this.lifecycle
      || this.status.phase === "protocol-error"
      || this.reconnectTimer !== null) return;
    const delayMs = Math.min(8_000, 500 * (2 ** Math.min(this.reconnectAttempt, 4)));
    this.reconnectAttempt += 1;
    this.status = {
      ...this.status,
      phase: "offline",
      message: `实时连接已断开，${(delayMs / 1_000).toFixed(1)} 秒后重试。`,
      canExecute: false,
      errorCode: "COMPUTER_OFFLINE",
    };
    this.notify();
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(lifecycle);
    }, delayMs);
  }

  private stop(): void {
    this.started = false;
    this.lifecycle += 1;
    this.connecting = false;
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopMetadataPolling();
    const socket = this.socket;
    this.socket = null;
    socket?.close(1000, "No active subscribers");
  }

  private httpUrl(path: string): string {
    return controlCenterHttpUrl(this.apiBase, path, this.deviceId, window.location.origin);
  }

  private request(url: string, init: RequestInit = {}): Promise<Response> {
    return fetch(url, { ...init, credentials: "include" });
  }

  private webSocketUrl(): string {
    return controlCenterWebSocketUrl(this.apiBase, this.deviceId, window.location.origin);
  }

  private isProtocolError(error: unknown): boolean {
    return error instanceof SyntaxError
      || (error instanceof Error && /协议|消息类型|schemaVersion/.test(error.message));
  }

  private errorMessage(error: unknown, fallback = "收到不兼容的后端协议。"): string {
    return error instanceof RelayApiError
      ? relayErrorText(error.code, error.message)
      : error instanceof Error && error.message ? error.message : fallback;
  }

  private reflectApiError(error: RelayApiError): void {
    if (!this.started) return;
    if (error.code === "UNAUTHORIZED") {
      this.setDisconnected("auth-error", relayErrorText(error.code, error.message), error.code);
      this.socket?.close(1008, "Access authentication required");
      return;
    }
    if (error.code === "INVALID_DEVICE") {
      this.setDisconnected("protocol-error", relayErrorText(error.code, error.message), error.code);
      this.socket?.close(1008, "Invalid device configuration");
      return;
    }
    if (error.code === "COMPUTER_OFFLINE") {
      this.setDisconnected("offline", relayErrorText(error.code, error.message), error.code);
      if (this.socket) this.socket.close(1012, "Local computer offline");
      else this.scheduleReconnect(this.lifecycle);
    }
  }

  private async refreshDeviceMetadata(lifecycle: number): Promise<void> {
    const response = await this.request(this.httpUrl("api/devices"), {
      headers: { accept: "application/json", "cache-control": "no-store" },
    });
    if (!response.ok) {
      const error = await this.apiError(response, `设备状态请求失败（HTTP ${response.status}）。`);
      // The local backend intentionally has no GET /api/devices route. State and
      // WebSocket connectivity still provide the authoritative local-mode signal.
      if (error.code === "UNAUTHORIZED") throw error;
      return;
    }
    const body = await response.json() as {
      devices?: Array<{ deviceId?: unknown; status?: unknown; lastSeenAt?: unknown }>;
    };
    if (!this.started || lifecycle !== this.lifecycle) return;
    const device = body.devices?.find((item) => item.deviceId === this.deviceId);
    // A direct local backend exposes its domain device list at the same route.
    // Relay metadata is optional there; the state and WebSocket contracts remain authoritative.
    if (!device) return;
    const lastSeenAt = typeof device.lastSeenAt === "string" && Number.isFinite(Date.parse(device.lastSeenAt))
      ? device.lastSeenAt
      : null;
    this.status = { ...this.status, lastSeenAt };
    if (device.status === "offline" && this.status.phase === "online") {
      this.setDisconnected("offline", relayErrorText("COMPUTER_OFFLINE", ""), "COMPUTER_OFFLINE");
      this.socket?.close(1012, "Local computer offline");
      this.scheduleReconnect(lifecycle);
      return;
    }
    this.notify();
  }

  private startMetadataPolling(lifecycle: number): void {
    this.stopMetadataPolling();
    this.metadataTimer = window.setInterval(() => {
      void this.refreshDeviceMetadata(lifecycle).catch((error) => {
        if (error instanceof RelayApiError && error.code === "UNAUTHORIZED") {
          this.setDisconnected("auth-error", relayErrorText(error.code, error.message), error.code);
          this.socket?.close(1008, "Access authentication required");
        }
      });
    }, 15_000);
  }

  private stopMetadataPolling(): void {
    if (this.metadataTimer !== null) {
      window.clearInterval(this.metadataTimer);
      this.metadataTimer = null;
    }
  }

  private notify(): void {
    const nextSnapshot = this.getSnapshot();
    const nextStatus = this.getStatus();
    this.listeners.forEach((listener) => listener(nextSnapshot, nextStatus));
  }
}

const adapterMode = import.meta.env.VITE_CONTROL_CENTER_ADAPTER?.toLowerCase()
  ?? (import.meta.env.PROD ? "live" : "mock");
if (adapterMode !== "mock" && adapterMode !== "live") {
  throw new Error(`Unsupported VITE_CONTROL_CENTER_ADAPTER: ${adapterMode}`);
}

export const controlCenterAdapter: ControlCenterAdapter = adapterMode === "live"
  ? new LiveControlCenterAdapter(
    import.meta.env.VITE_CONTROL_CENTER_API_BASE ?? "/",
    configuredDeviceId,
  )
  : new MockControlCenterAdapter();
