import type { SensorState } from "./types";

export function formatClock(date = new Date()): string {
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatEventTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--:--";
  return parsed.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

export function sensorLabel(state: SensorState): string {
  const labels: Record<SensorState, string> = {
    ready: "READY",
    active: "ACTIVE",
    standby: "STANDBY",
    offline: "OFFLINE",
  };
  return labels[state];
}

export function percent(value: number | null): string {
  return value === null ? "--" : `${Math.round(value * 100)}%`;
}
