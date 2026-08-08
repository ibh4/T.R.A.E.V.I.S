import type { AppState, DemoScenarioId, HomeEvent } from "./types";

export const demoScenarios: Array<{ id: DemoScenarioId; label: string; icon: string }> = [
  { id: "normal", label: "正常", icon: "shield-check" },
  { id: "motion", label: "运动", icon: "scan-line" },
  { id: "person", label: "人员", icon: "user-round" },
  { id: "delivery", label: "快递", icon: "package" },
  { id: "help", label: "求助", icon: "siren" },
  { id: "kitchen", label: "厨房", icon: "flame" },
  { id: "fall", label: "跌倒", icon: "person-standing" },
  { id: "ack", label: "确认", icon: "check-circle-2" },
];

export interface DemoResult {
  event: HomeEvent | null;
  autoReturn: boolean;
}

export function applyDemoScenario(state: AppState, scenario: DemoScenarioId): DemoResult {
  if (scenario === "normal") {
    state.snapshot.camera = "ready";
    state.snapshot.microphone = "ready";
    state.snapshot.visionFps = 5;
    state.snapshot.motionScore = 0;
    state.snapshot.audioLevel = 0.18;
    state.snapshot.keywordConfidence = null;
    state.snapshot.lastTranscript = null;
    state.severity = "normal";
    state.mood = "idle";
    return { event: null, autoReturn: false };
  }

  if (scenario === "ack") {
    const target = state.snapshot.events.find((event) => event.id === state.selectedEventId && !event.resolved)
      ?? state.snapshot.events.find((event) => !event.resolved);
    if (!target) return { event: null, autoReturn: false };
    target.resolved = true;
    const ack = createEvent({
      type: "user_acknowledged",
      title: "用户已确认",
      detail: "家庭事件已由用户确认处理",
      source: "speech",
      level: "info",
      zone: target.zone,
      resolved: true,
    });
    prependEvent(state, ack);
    state.selectedEventId = target.id;
    state.severity = "resolved";
    state.mood = "success";
    return { event: ack, autoReturn: true };
  }

  const event = scenarioEvent(scenario);
  prependEvent(state, event);
  state.selectedEventId = event.id;
  applySensorEvidence(state, scenario);

  if (event.level === "high") {
    if (state.page !== "events") state.returnPage = state.page;
    state.page = "events";
    state.severity = "critical";
    state.mood = "alert";
  } else if (event.level === "medium") {
    state.severity = "attention";
    state.mood = "thinking";
  }

  return { event, autoReturn: false };
}

export function resolveSelectedEvent(state: AppState): boolean {
  const event = state.snapshot.events.find((item) => item.id === state.selectedEventId);
  if (!event || event.resolved) return false;
  event.resolved = true;
  state.severity = "resolved";
  state.mood = "success";
  return true;
}

export function finishResolvedTakeover(state: AppState): void {
  state.page = state.returnPage ?? "guard";
  state.returnPage = null;
  state.severity = "normal";
  state.mood = "idle";
}

function scenarioEvent(scenario: Exclude<DemoScenarioId, "normal" | "ack">): HomeEvent {
  const scenarios: Record<typeof scenario, Omit<HomeEvent, "id" | "occurredAt">> = {
    motion: {
      type: "motion_detected",
      title: "检测到运动线索",
      detail: "客厅摄像头检测到连续帧运动",
      source: "vision",
      level: "info",
      zone: "living_room",
    },
    person: {
      type: "person_detected",
      title: "检测到人员",
      detail: "运动触发后的目标检测确认人员",
      source: "vision",
      level: "medium",
      zone: "living_room",
      confidence: 0.91,
    },
    delivery: {
      type: "delivery_detected",
      title: "门口发现包裹",
      detail: "门口摄像头产生低优先级包裹提醒",
      source: "mock",
      level: "low",
      zone: "door",
      confidence: 0.88,
    },
    help: {
      type: "help_keyword_detected",
      title: "检测到求助短语",
      detail: "本地语音识别命中明确求助表达",
      source: "speech",
      level: "high",
      zone: "living_room",
      confidence: 0.94,
    },
    kitchen: {
      type: "kitchen_risk_detected",
      title: "厨房风险待确认",
      detail: "厨房区域产生需要用户确认的风险候选事件",
      source: "mock",
      level: "high",
      zone: "kitchen",
      confidence: 0.86,
    },
    fall: {
      type: "fall_suspected",
      title: "疑似跌倒待确认",
      detail: "客厅区域产生疑似跌倒候选事件",
      source: "mock",
      level: "high",
      zone: "living_room",
      confidence: 0.82,
    },
  };
  return createEvent(scenarios[scenario]);
}

function createEvent(input: Omit<HomeEvent, "id" | "occurredAt">): HomeEvent {
  return {
    ...input,
    id: `evt_${crypto.randomUUID().replaceAll("-", "")}`,
    occurredAt: new Date().toISOString(),
  };
}

function prependEvent(state: AppState, event: HomeEvent): void {
  state.snapshot.events = [event, ...state.snapshot.events].slice(0, 20);
}

function applySensorEvidence(state: AppState, scenario: DemoScenarioId): void {
  if (["motion", "person", "delivery", "kitchen", "fall"].includes(scenario)) {
    state.snapshot.camera = "active";
    state.snapshot.visionFps = 5;
  }
  if (scenario === "motion") state.snapshot.motionScore = 0.08;
  if (scenario === "person") state.snapshot.inferenceMs = 82;
  if (scenario === "help") {
    state.snapshot.microphone = "active";
    state.snapshot.audioLevel = 0.78;
    state.snapshot.keywordConfidence = 0.94;
    state.snapshot.lastTranscript = "请帮帮我";
  }
}
