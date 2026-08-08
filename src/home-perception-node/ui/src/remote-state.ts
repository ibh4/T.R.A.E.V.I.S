import type {
  AppState,
  HomeEvent,
  MediaDeviceInfo,
  MediaInventory,
  RemoteEvent,
  RemoteMediaDevice,
  RemoteMediaInventory,
  RemoteSnapshot,
} from "./types";

export interface RemoteApplyResult {
  tookOver: boolean;
  resolvedTakeover: boolean;
}

export function mapRemoteMediaInventory(remote: RemoteMediaInventory): MediaInventory {
  return {
    scannedAt: remote.scanned_at,
    cameras: remote.cameras.map(mapRemoteMediaDevice),
    microphones: remote.microphones.map(mapRemoteMediaDevice),
    settings: {
      cameraId: remote.settings.camera_id,
      cameraIndex: remote.settings.camera_index,
      microphoneId: remote.settings.microphone_id,
      microphoneIndex: remote.settings.microphone_index,
      updatedAt: remote.settings.updated_at,
    },
    warnings: remote.warnings,
  };
}

function mapRemoteMediaDevice(remote: RemoteMediaDevice): MediaDeviceInfo {
  return {
    kind: remote.kind,
    stableId: remote.stable_id,
    name: remote.name,
    index: remote.index,
    backend: remote.backend,
    maxInputChannels: remote.max_input_channels,
    defaultSampleRate: remote.default_sample_rate,
    frameWidth: remote.frame_width,
    frameHeight: remote.frame_height,
    frameRate: remote.frame_rate,
  };
}

export function applyRemoteSnapshot(state: AppState, remote: RemoteSnapshot): RemoteApplyResult {
  const previousById = new Map(state.snapshot.events.map((event) => [event.id, event]));
  const incomingEvents = remote.events.map(mapRemoteEvent);
  const newHighEvent = incomingEvents.find(
    (event) => !event.resolved && event.level === "high" && !previousById.has(event.id),
  );
  const selectedBefore = state.selectedEventId ? previousById.get(state.selectedEventId) : undefined;
  const selectedAfter = state.selectedEventId
    ? incomingEvents.find((event) => event.id === state.selectedEventId)
    : undefined;

  state.snapshot = {
    connected: remote.connected,
    deviceId: remote.device_id,
    camera: remote.camera,
    microphone: remote.microphone,
    visionFps: remote.vision_fps,
    inferenceMs: remote.inference_ms,
    motionScore: remote.motion_score,
    audioLevel: remote.audio_level,
    keywordConfidence: remote.keyword_confidence,
    cpuTemp: remote.cpu_temp,
    uptimeSeconds: remote.uptime_seconds,
    previewUrl: remote.preview_url,
    lastTranscript: remote.last_transcript,
    lastError: remote.last_error,
    events: incomingEvents,
  };

  if (newHighEvent) {
    if (state.page !== "events") state.returnPage = state.page;
    state.page = "events";
    state.selectedEventId = newHighEvent.id;
    state.severity = "critical";
    state.mood = "alert";
    return { tookOver: true, resolvedTakeover: false };
  }

  const resolvedTakeover = Boolean(selectedBefore && !selectedBefore.resolved && selectedAfter?.resolved);
  if (resolvedTakeover) {
    state.severity = "resolved";
    state.mood = "success";
  }

  if (!state.selectedEventId || !incomingEvents.some((event) => event.id === state.selectedEventId)) {
    state.selectedEventId = incomingEvents[0]?.id ?? null;
  }
  return { tookOver: false, resolvedTakeover };
}

function mapRemoteEvent(event: RemoteEvent): HomeEvent {
  const payloadSummary = typeof event.payload.summary === "string" ? event.payload.summary : null;
  const payloadText = typeof event.payload.text === "string" ? event.payload.text : null;
  const copy = eventCopy(event.type);
  return {
    id: event.event_id,
    type: event.type,
    title: copy.title,
    detail: payloadSummary ?? payloadText ?? copy.detail,
    source: event.source,
    level: event.level,
    zone: event.zone,
    occurredAt: event.occurred_at,
    confidence: event.confidence ?? undefined,
    resolved: event.resolved ?? false,
    snapshotUrl: event.snapshot_url,
  };
}

function eventCopy(type: string): { title: string; detail: string } {
  const known: Record<string, { title: string; detail: string }> = {
    node_ready: { title: "本地服务已就绪", detail: "家庭感知本地服务已启动" },
    motion_detected: { title: "检测到运动线索", detail: "摄像头检测到连续帧运动" },
    person_detected: { title: "检测到人员", detail: "二级目标检测确认人员" },
    delivery_detected: { title: "门口发现包裹", detail: "门口产生低优先级包裹提醒" },
    visitor_detected: { title: "门口检测到访客", detail: "访客在门口区域停留" },
    door_event_detected: { title: "门口事件待确认", detail: "门口产生需要确认的异常事件" },
    help_keyword_detected: { title: "检测到求助短语", detail: "本地语音识别命中明确求助表达" },
    kitchen_risk_detected: { title: "厨房风险待确认", detail: "厨房区域产生风险候选事件" },
    fall_suspected: { title: "疑似跌倒待确认", detail: "客厅区域产生疑似跌倒候选事件" },
    speech_transcribed: { title: "语音转写完成", detail: "本地语音识别完成" },
    audio_filtered: { title: "音频未进入识别", detail: "音频过短或音量过低" },
    user_acknowledged: { title: "用户已确认", detail: "家庭事件已确认处理" },
  };
  return known[type] ?? { title: type.replaceAll("_", " ").toUpperCase(), detail: "家庭感知节点产生新事件" };
}
