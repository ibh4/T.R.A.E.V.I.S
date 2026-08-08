import type {
  DeviceHeartbeatListener,
  DeviceSource,
  IntervalScheduler,
} from "../../modules/devices/device-source.js";
import { systemIntervalScheduler } from "../../modules/devices/device-source.js";
import {
  HEARTBEAT_INTERVAL_MS,
  type DeviceSeed,
} from "../../modules/devices/devices-types.js";

const activeDeviceIds = [
  "pc-core-01",
  "home-node-rpi4-01",
  "camera-ov5647-01",
  "robot-spider-01",
] as const;

export class MockDeviceSource implements DeviceSource {
  readonly adapterMode = "mock" as const;
  private intervalHandle: unknown;
  private listener: DeviceHeartbeatListener | undefined;
  private generation = 0;

  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly scheduler: IntervalScheduler = systemIntervalScheduler,
  ) {}

  getInitialDevices(): DeviceSeed[] {
    const now = this.now().getTime();
    const lastSeen = (millisecondsAgo: number) => new Date(now - millisecondsAgo).toISOString();
    return [
      {
        deviceId: "pc-core-01",
        name: "TRAEVIS PC Core",
        kind: "pc",
        zone: "书房",
        detail: "状态服务与 Control Center 后端运行中",
        lastSeen: lastSeen(0),
        metricLabel: "CORE TEMP",
        metricValue: "46°C",
      },
      {
        deviceId: "home-node-rpi4-01",
        name: "家庭感知节点 01",
        kind: "home-node",
        zone: "客厅",
        detail: "运动检测运行中，真实事件 Adapter 待接入",
        lastSeen: lastSeen(0),
        metricLabel: "VISION FPS",
        metricValue: "4.8",
      },
      {
        deviceId: "camera-ov5647-01",
        name: "OV5647 Camera",
        kind: "camera",
        zone: "客厅",
        detail: "1920 × 1080 / 稀疏推理",
        lastSeen: lastSeen(0),
        metricLabel: "FRAME AGE",
        metricValue: "0.2s",
      },
      {
        deviceId: "microphone-usb-01",
        name: "USB Microphone",
        kind: "microphone",
        zone: "客厅",
        detail: "设备已选择，真实采样尚未验收",
        lastSeen: lastSeen(20_000),
        metricLabel: "INPUT LEVEL",
        metricValue: "--",
      },
      {
        deviceId: "badge-esp32-01",
        name: "TRAEVIS 实体终端",
        kind: "badge",
        zone: "书房",
        detail: "Mock 心跳已暂停，可通过 heartbeat API 恢复",
        lastSeen: lastSeen(50_000),
        metricLabel: "BATTERY",
        metricValue: "91%",
      },
      {
        deviceId: "robot-spider-01",
        name: "蜘蛛机器人",
        kind: "robot",
        zone: "书房",
        detail: "USB 转发链路待协议接入",
        lastSeen: lastSeen(0),
        metricLabel: "BATTERY",
        metricValue: "82%",
      },
    ];
  }

  start(listener: DeviceHeartbeatListener): void {
    if (this.intervalHandle !== undefined) {
      throw new Error("MockDeviceSource has already started");
    }
    this.listener = listener;
    const generation = this.generation;
    this.intervalHandle = this.scheduler.set(() => {
      if (generation !== this.generation) return;
      for (const deviceId of activeDeviceIds) {
        this.listener?.(deviceId, {});
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  close(): void {
    this.generation += 1;
    if (this.intervalHandle !== undefined) {
      this.scheduler.clear(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    this.listener = undefined;
  }
}
