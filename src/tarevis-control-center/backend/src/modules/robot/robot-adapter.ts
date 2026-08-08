import type { AdapterMode } from "../../core/contracts.js";
import type { CommandRecord } from "../commands/commands-types.js";
import type { RobotInstruction } from "./robot-types.js";

export interface RobotAdapter {
  readonly adapterMode: AdapterMode;
  execute(command: CommandRecord, instruction: RobotInstruction): void;
  emergencyStop(command: CommandRecord, instruction: RobotInstruction): void;
  reset(): void | Promise<void>;
  close(): void | Promise<void>;
}
