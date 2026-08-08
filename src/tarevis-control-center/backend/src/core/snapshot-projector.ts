import type { RuntimeMode } from "../config.js";
import type { ControlCenterModule, ControlCenterSnapshot } from "./contracts.js";
import { noopLogger, type AppLogger } from "./logger.js";

const unavailableAt = "1970-01-01T00:00:00.000Z";

export function createEmptySnapshot(
  mode: RuntimeMode,
  connection: ControlCenterSnapshot["connection"],
  lastSyncedAt = unavailableAt,
): ControlCenterSnapshot {
  return {
    mode,
    connection,
    lastSyncedAt,
    home: {
      state: "unavailable",
      label: "未接入",
      summary: "家庭事件模块尚未接入。",
      activeZone: "--",
      updatedAt: unavailableAt,
    },
    trae: {
      state: "offline",
      label: "未接入",
      project: "--",
      task: "TRAE 模块尚未接入。",
      progress: 0,
      suggestion: "等待 TRAE Adapter 接入。",
      updatedAt: unavailableAt,
    },
    robot: {
      state: "offline",
      label: "未接入",
      connection: "offline",
      battery: 0,
      task: "机器人模块尚未接入。",
      updatedAt: unavailableAt,
    },
    devices: [],
    events: [],
    commands: [],
    services: [],
    resources: [],
  };
}

export class SnapshotProjector {
  constructor(
    private readonly mode: RuntimeMode,
    private readonly modules: ReadonlyMap<string, ControlCenterModule>,
    private readonly now: () => Date = () => new Date(),
    private readonly logger: AppLogger = noopLogger,
  ) {}

  project(): ControlCenterSnapshot {
    const snapshot = createEmptySnapshot(this.mode, "online", this.now().toISOString());
    for (const module of this.modules.values()) {
      try {
        Object.assign(snapshot, module.getSlice());
      } catch (error) {
        snapshot.connection = "degraded";
        this.logger.error("snapshot.module_projection_failed", {
          moduleId: module.moduleId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return structuredClone(snapshot);
  }
}
