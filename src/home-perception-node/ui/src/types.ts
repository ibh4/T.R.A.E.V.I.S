export type PageId = "guard" | "vision" | "audio" | "events" | "device";

export type Mood = "idle" | "thinking" | "listening" | "alert" | "success";

export type Severity = "normal" | "attention" | "critical" | "resolved";

export type SensorState = "ready" | "active" | "standby" | "offline";

export type DemoScenarioId = "normal" | "motion" | "person" | "delivery" | "help" | "kitchen" | "fall" | "ack";

export interface HomeEvent {
  id: string;
  type: string;
  title: string;
  detail: string;
  source: "vision" | "speech" | "audio" | "system" | "mock";
  level: "info" | "low" | "medium" | "high";
  zone: string;
  occurredAt: string;
  confidence?: number;
  resolved?: boolean;
  snapshotUrl?: string;
}

export interface RuntimeSnapshot {
  connected: boolean;
  deviceId: string;
  camera: SensorState;
  microphone: SensorState;
  visionFps: number;
  inferenceMs: number | null;
  motionScore: number;
  audioLevel: number;
  keywordConfidence: number | null;
  cpuTemp: number | null;
  uptimeSeconds: number;
  previewUrl: string | null;
  lastTranscript: string | null;
  lastError: string | null;
  events: HomeEvent[];
}

export interface AppState {
  page: PageId;
  mood: Mood;
  severity: Severity;
  snapshot: RuntimeSnapshot;
  selectedEventId: string | null;
  returnPage: PageId | null;
  demoPanelOpen: boolean;
  notice: string | null;
  mediaSettingsOpen: boolean;
  mediaBusy: boolean;
  mediaInventory: MediaInventory | null;
  mediaDraft: MediaSettingsDraft;
}

export interface MediaDeviceInfo {
  kind: "camera" | "microphone";
  stableId: string;
  name: string;
  index: number;
  backend: string | null;
  maxInputChannels: number | null;
  defaultSampleRate: number | null;
  frameWidth: number | null;
  frameHeight: number | null;
  frameRate: number | null;
}

export interface MediaSettings {
  cameraId: string | null;
  cameraIndex: number | null;
  microphoneId: string | null;
  microphoneIndex: number | null;
  updatedAt: string | null;
}

export interface MediaSettingsDraft {
  cameraId: string | null;
  microphoneId: string | null;
}

export interface MediaInventory {
  scannedAt: string;
  cameras: MediaDeviceInfo[];
  microphones: MediaDeviceInfo[];
  settings: MediaSettings;
  warnings: string[];
}

export interface RemoteEvent {
  event_id: string;
  device_id: string;
  source: HomeEvent["source"];
  type: string;
  level: HomeEvent["level"];
  occurred_at: string;
  zone: string;
  confidence: number | null;
  payload: Record<string, unknown>;
  resolved?: boolean;
  snapshot_url?: string;
}

export interface RemoteSnapshot {
  connected: boolean;
  device_id: string;
  camera: SensorState;
  microphone: SensorState;
  vision_fps: number;
  inference_ms: number | null;
  motion_score: number;
  audio_level: number;
  keyword_confidence: number | null;
  cpu_temp: number | null;
  uptime_seconds: number;
  preview_url: string | null;
  last_transcript: string | null;
  last_error: string | null;
  events: RemoteEvent[];
}

export interface RemoteMediaDevice {
  kind: MediaDeviceInfo["kind"];
  stable_id: string;
  name: string;
  index: number;
  backend: string | null;
  max_input_channels: number | null;
  default_sample_rate: number | null;
  frame_width: number | null;
  frame_height: number | null;
  frame_rate: number | null;
}

export interface RemoteMediaInventory {
  scanned_at: string;
  cameras: RemoteMediaDevice[];
  microphones: RemoteMediaDevice[];
  settings: {
    camera_id: string | null;
    camera_index: number | null;
    microphone_id: string | null;
    microphone_index: number | null;
    updated_at: string | null;
  };
  warnings: string[];
}

export interface RemoteMediaTestResult {
  kind: "camera" | "microphone";
  ok: boolean;
  stable_id: string | null;
  message: string;
  details: Record<string, unknown>;
}
