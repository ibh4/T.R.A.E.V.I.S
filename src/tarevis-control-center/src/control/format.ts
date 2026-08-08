import type { CommandStatus, ConnectionState, Severity } from "./types";

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function formatRelativeTime(value: string): string {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000));
  if (deltaSeconds < 60) {
    return `${deltaSeconds} 秒前`;
  }
  if (deltaSeconds < 3_600) {
    return `${Math.floor(deltaSeconds / 60)} 分钟前`;
  }
  return `${Math.floor(deltaSeconds / 3_600)} 小时前`;
}

export const severityLabels: Record<Severity, string> = {
  info: "信息",
  warning: "注意",
  critical: "紧急",
};

export const connectionLabels: Record<ConnectionState, string> = {
  online: "在线",
  degraded: "受限",
  offline: "离线",
};

export const commandStatusLabels: Record<CommandStatus, string> = {
  requested: "发送中",
  accepted: "已接受",
  running: "执行中",
  succeeded: "成功",
  failed: "失败",
  expired: "超时",
};
