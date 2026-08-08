import type {
  AdapterConnectionStatus,
  CommandRecord,
  ConnectionState,
  ControlCenterSnapshot,
} from "./types";

export const TRAE_UNREAD_RESPONSE_RESULT = "指令已发送给 TRAE，但未读取到回复。";
export const TRAE_TIMEOUT_RESULT = "TRAE Bridge 调用超时，发送结果可能未知。";

export function getTraeConnection(
  snapshot: ControlCenterSnapshot,
  adapterStatus?: AdapterConnectionStatus,
): ConnectionState {
  if (adapterStatus && adapterStatus.phase !== "online") return "offline";
  const service = snapshot.services.find((candidate) => candidate.serviceId === "trae-adapter");
  if (service) return service.connection;
  return snapshot.trae.state === "offline" ? "offline" : "online";
}

export function getTraeAdapterMode(snapshot: ControlCenterSnapshot): "mock" | "live" {
  return snapshot.services.find((candidate) => candidate.serviceId === "trae-adapter")?.adapterMode
    ?? snapshot.commands.find((command) => command.target === "trae")?.adapterMode
    ?? (snapshot.mode === "live" ? "live" : "mock");
}

export function traeCommandStatusLabel(command: Pick<CommandRecord, "status" | "result">): string {
  switch (command.status) {
    case "requested": return "已请求";
    case "accepted": return "已进入本地队列";
    case "running": return "正在投递/等待结果";
    case "succeeded": return command.result && command.result !== TRAE_UNREAD_RESPONSE_RESULT
      ? "已读取回复"
      : "已发送";
    case "failed": return "发送失败";
    case "expired": return "调用超时，结果可能未知";
  }
}

export function traeCommandResultText(command: CommandRecord): string {
  if (command.result) return command.result;
  switch (command.status) {
    case "requested": return "等待后端接收指令。";
    case "accepted": return "指令已进入本地队列，等待投递。";
    case "running": return "正在投递指令并等待 Bridge 结果。";
    case "succeeded": return "指令已发送给 TRAE。";
    case "failed": return "TRAE 指令发送失败。";
    case "expired": return TRAE_TIMEOUT_RESULT;
  }
}

export function traeSnapshotLabel(snapshot: ControlCenterSnapshot): string {
  const latest = snapshot.commands.find((command) => command.target === "trae");
  return latest ? traeCommandStatusLabel(latest) : snapshot.trae.label;
}
