export type Severity = "info" | "warning" | "critical";
export type EventState = "detected" | "acknowledged" | "resolved" | "escalated";
export type ConnectionState = "online" | "degraded" | "offline";
export type RuntimeMode = "mock" | "live" | "hybrid";
export type CommandStatus =
  | "requested"
  | "accepted"
  | "running"
  | "succeeded"
  | "failed"
  | "expired";

export interface HomeStatus {
  state: "normal" | "attention" | "emergency" | "unavailable";
  label: string;
  summary: string;
  activeZone: string;
  updatedAt: string;
}

export interface TraeStatus {
  state: "idle" | "analyzing" | "working" | "blocked" | "offline";
  label: string;
  project: string;
  task: string;
  progress: number;
  suggestion: string;
  updatedAt: string;
}

export interface RobotStatus {
  state: "standby" | "executing" | "blocked" | "offline";
  label: string;
  connection: ConnectionState;
  battery: number;
  task: string;
  updatedAt: string;
}

export interface DeviceStatus {
  deviceId: string;
  name: string;
  kind: "pc" | "home-node" | "camera" | "microphone" | "badge" | "robot";
  zone: string;
  connection: ConnectionState;
  detail: string;
  lastSeen: string;
  metricLabel: string;
  metricValue: string;
  adapterMode: "mock" | "live";
}

export interface ControlEvent {
  schemaVersion: "1.0";
  eventId: string;
  deviceId: string;
  source: "vision" | "audio" | "system" | "trae" | "robot";
  type: string;
  level: Severity;
  state: EventState;
  updatedAt: string;
  occurredAt: string;
  zone: string;
  confidence?: number;
  title: string;
  summary: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  adapterMode: "mock" | "live";
  payload: Record<string, unknown>;
}

export interface CommandRecord {
  commandId: string;
  requestId: string;
  target: "trae" | "robot" | "home-node" | "system";
  input: string;
  status: CommandStatus;
  requestedAt: string;
  updatedAt: string;
  result?: string;
  adapterMode: "mock" | "live";
}

export interface ServiceStatus {
  serviceId: string;
  name: string;
  connection: ConnectionState;
  adapterMode: "mock" | "live";
  version: string;
  latency: string;
  detail: string;
}

export interface ResourceMetric {
  id: string;
  label: string;
  value: number;
  displayValue: string;
  tone: "green" | "cyan" | "yellow" | "red";
  history: number[];
}

export interface ControlCenterSnapshot {
  mode: RuntimeMode;
  connection: ConnectionState;
  lastSyncedAt: string;
  home: HomeStatus;
  trae: TraeStatus;
  robot: RobotStatus;
  devices: DeviceStatus[];
  events: ControlEvent[];
  commands: CommandRecord[];
  services: ServiceStatus[];
  resources: ResourceMetric[];
}

export interface SubmitCommandInput {
  target: CommandRecord["target"];
  input: string;
  requestId?: string;
}

export type RobotAction =
  | "forward"
  | "backward"
  | "turn_left"
  | "turn_right"
  | "patrol"
  | "return_home"
  | "stop"
  | "emergency_stop";

export interface RobotCommandRequest {
  action: Exclude<RobotAction, "emergency_stop">;
  params: { distanceCm?: number; angleDeg?: number };
  confirmed: boolean;
  requestId?: string;
}

export interface SnapshotEnvelope {
  schemaVersion: "1.0";
  revision: number;
  snapshot: ControlCenterSnapshot;
}

export interface SnapshotMessage extends SnapshotEnvelope {
  type: "snapshot";
}

export type AdapterConnectionPhase = "loading" | "online" | "offline" | "protocol-error" | "auth-error";

export interface AdapterConnectionStatus {
  phase: AdapterConnectionPhase;
  message: string;
  deviceId: string;
  revision: number | null;
  lastSeenAt: string | null;
  canExecute: boolean;
  errorCode?: string;
}
