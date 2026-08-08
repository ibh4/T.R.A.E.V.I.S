import type { AdapterMode } from "../../core/contracts.js";
import type { ControlEvent, EventReportInput } from "./events-types.js";

export type EventReportListener = (input: EventReportInput) => void;

export interface EventSource {
  readonly adapterMode: AdapterMode;
  getInitialEvents(): ControlEvent[];
  start(listener: EventReportListener): void;
  close(): void | Promise<void>;
}
