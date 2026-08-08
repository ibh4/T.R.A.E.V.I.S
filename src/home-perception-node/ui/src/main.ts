import "@fontsource/archivo-black/400.css";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/700.css";
import {
  Activity,
  AlertTriangle,
  AudioLines,
  BellRing,
  Camera,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Cpu,
  Eye,
  Flame,
  House,
  Mic,
  Package,
  PersonStanding,
  Play,
  RotateCw,
  Save,
  ScanLine,
  Settings,
  ShieldCheck,
  Siren,
  Square,
  Thermometer,
  UserRound,
  X,
  createIcons,
} from "lucide";
import { HomeNodeApi } from "./api";
import { initialState } from "./demo-data";
import { applyDemoScenario, finishResolvedTakeover, resolveSelectedEvent } from "./demo-scenarios";
import { formatClock } from "./format";
import { applyRemoteSnapshot, mapRemoteMediaInventory } from "./remote-state";
import { appMarkup } from "./screens";
import type { AppState, DemoScenarioId, PageId } from "./types";
import "./styles.css";

const app = getAppRoot();

let state: AppState = structuredClone(initialState);
let returnTimer: number | null = null;
let noticeTimer: number | null = null;

const query = new URLSearchParams(window.location.search);
const requestedPage = query.get("page");
if (isPageId(requestedPage)) state.page = requestedPage;
const standalone = query.get("standalone") === "1";
if (!standalone) {
  state.mediaInventory = null;
  state.mediaDraft = { cameraId: null, microphoneId: null };
}

function getAppRoot(): HTMLDivElement {
  const root = document.querySelector<HTMLDivElement>("#app");
  if (!root) throw new Error("#app root is missing");
  return root;
}

function isPageId(value: string | null): value is PageId {
  return value !== null && ["guard", "vision", "audio", "events", "device"].includes(value);
}

const icons = {
  Activity,
  AlertTriangle,
  AudioLines,
  BellRing,
  Camera,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Cpu,
  Eye,
  Flame,
  House,
  Mic,
  Package,
  PersonStanding,
  Play,
  RotateCw,
  Save,
  ScanLine,
  Settings,
  ShieldCheck,
  Siren,
  Square,
  Thermometer,
  UserRound,
  X,
};

const api = new HomeNodeApi({
  onSnapshot: (snapshot) => {
    const result = applyRemoteSnapshot(state, snapshot);
    render();
    if (result.resolvedTakeover) scheduleTakeoverReturn();
  },
  onConnection: (connected) => {
    if (state.snapshot.connected === connected) return;
    state.snapshot.connected = connected;
    render();
  },
  onError: showNotice,
  onMediaInventory: (inventory) => {
    state.mediaInventory = mapRemoteMediaInventory(inventory);
    state.mediaDraft = {
      cameraId: state.mediaInventory.settings.cameraId,
      microphoneId: state.mediaInventory.settings.microphoneId,
    };
    state.mediaBusy = false;
    render();
  },
});

function render(): void {
  document.documentElement.style.setProperty("--motion-time", `${-(performance.now() / 1000).toFixed(3)}s`);
  app.innerHTML = appMarkup(state);
  createIcons({ icons });
  bindInteractions();
  updateClock();
}

function bindInteractions(): void {
  app.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach((button) => {
    button.addEventListener("click", () => {
      state.page = button.dataset.nav as PageId;
      render();
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-event-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedEventId = button.dataset.eventId ?? null;
      render();
    });
  });

  app.querySelector<HTMLButtonElement>('[data-action="toggle-demo"]')?.addEventListener("click", () => {
    state.demoPanelOpen = !state.demoPanelOpen;
    render();
  });

  app.querySelectorAll<HTMLButtonElement>('[data-action="close-demo"]').forEach((button) => {
    button.addEventListener("click", () => {
      state.demoPanelOpen = false;
      render();
    });
  });

  app.querySelectorAll<HTMLButtonElement>("[data-demo]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (returnTimer !== null) window.clearTimeout(returnTimer);
      const scenario = button.dataset.demo as DemoScenarioId;
      if (state.snapshot.connected) {
        state.demoPanelOpen = false;
        render();
        await runRemoteAction(() => api.triggerMock(scenario));
        return;
      }
      const result = applyDemoScenario(state, scenario);
      state.demoPanelOpen = false;
      render();
      if (result.autoReturn) scheduleTakeoverReturn();
    });
  });

  app.querySelector<HTMLButtonElement>('[data-action="toggle-camera"]')?.addEventListener("click", async () => {
    const active = state.snapshot.camera === "active";
    if (state.snapshot.connected) {
      await runRemoteAction(() => active ? api.stopVision() : api.startVision());
      return;
    }
    state.snapshot.camera = active ? "standby" : "active";
    state.snapshot.visionFps = active ? 0 : 5;
    state.mood = active ? "idle" : "thinking";
    render();
  });

  app.querySelector<HTMLButtonElement>('[data-action="toggle-audio"]')?.addEventListener("click", async () => {
    const active = state.snapshot.microphone === "active";
    if (state.snapshot.connected) {
      if (active) {
        showNotice("固定时长音频采样会自动结束");
        return;
      }
      await runRemoteAction(() => api.sampleAudio());
      return;
    }
    state.snapshot.microphone = active ? "standby" : "active";
    state.snapshot.audioLevel = active ? 0.18 : 0.64;
    state.mood = active ? "idle" : "listening";
    render();
  });

  app.querySelector<HTMLButtonElement>('[data-action="resolve-event"]')?.addEventListener("click", async () => {
    if (state.snapshot.connected && state.selectedEventId) {
      await runRemoteAction(() => api.acknowledge(state.selectedEventId as string));
      return;
    }
    if (!resolveSelectedEvent(state)) return;
    render();
    scheduleTakeoverReturn();
  });

  app.querySelector<HTMLButtonElement>('[data-action="refresh"]')?.addEventListener("click", () => {
    if (standalone) {
      render();
      return;
    }
    void runRemoteAction(() => api.refresh());
  });

  app.querySelector<HTMLButtonElement>('[data-action="open-media-settings"]')?.addEventListener("click", () => {
    state.mediaSettingsOpen = true;
    render();
    if (state.snapshot.connected) void runMediaAction(() => api.loadMediaDevices());
  });

  app.querySelector<HTMLButtonElement>('[data-action="close-media-settings"]')?.addEventListener("click", () => {
    if (state.mediaBusy) return;
    state.mediaSettingsOpen = false;
    render();
  });

  app.querySelector<HTMLSelectElement>('[data-media-device="camera"]')?.addEventListener("change", (event) => {
    state.mediaDraft.cameraId = (event.currentTarget as HTMLSelectElement).value || null;
    render();
  });

  app.querySelector<HTMLSelectElement>('[data-media-device="microphone"]')?.addEventListener("change", (event) => {
    state.mediaDraft.microphoneId = (event.currentTarget as HTMLSelectElement).value || null;
    render();
  });

  app.querySelector<HTMLButtonElement>('[data-action="scan-media"]')?.addEventListener("click", () => {
    if (standalone) {
      showNotice("模拟设备清单已刷新");
      return;
    }
    void runMediaAction(() => api.refreshMediaDevices(), "设备扫描完成");
  });

  app.querySelector<HTMLButtonElement>('[data-action="test-camera"]')?.addEventListener("click", () => {
    if (standalone) {
      showNotice("模拟摄像头测试通过");
      return;
    }
    void runMediaTest(() => api.testCamera(state.mediaDraft.cameraId));
  });

  app.querySelector<HTMLButtonElement>('[data-action="test-microphone"]')?.addEventListener("click", () => {
    if (standalone) {
      showNotice("模拟麦克风配置可用");
      return;
    }
    void runMediaTest(() => api.testMicrophone(state.mediaDraft.microphoneId));
  });

  app.querySelector<HTMLButtonElement>('[data-action="save-media"]')?.addEventListener("click", () => {
    if (standalone) {
      if (state.mediaInventory) {
        state.mediaInventory.settings.cameraId = state.mediaDraft.cameraId;
        state.mediaInventory.settings.microphoneId = state.mediaDraft.microphoneId;
      }
      showNotice("模拟设备配置已保存");
      return;
    }
    void runMediaAction(
      () => api.saveMediaSettings(state.mediaDraft),
      "设备配置已保存，重启本地服务后生效",
    );
  });
}

async function runRemoteAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    showNotice(error instanceof Error ? error.message : "本地服务请求失败");
  }
}

async function runMediaAction(action: () => Promise<void>, successMessage?: string): Promise<void> {
  state.mediaBusy = true;
  render();
  try {
    await action();
    if (successMessage) showNotice(successMessage);
  } catch (error) {
    showNotice(error instanceof Error ? error.message : "设备操作失败");
  } finally {
    state.mediaBusy = false;
    render();
  }
}

async function runMediaTest(action: () => Promise<{ message: string }>): Promise<void> {
  await runMediaAction(async () => {
    const result = await action();
    showNotice(result.message);
  });
}

function showNotice(message: string): void {
  if (noticeTimer !== null) window.clearTimeout(noticeTimer);
  state.notice = message;
  render();
  noticeTimer = window.setTimeout(() => {
    state.notice = null;
    noticeTimer = null;
    render();
  }, 2600);
}

function scheduleTakeoverReturn(): void {
  if (returnTimer !== null) window.clearTimeout(returnTimer);
  returnTimer = window.setTimeout(() => {
    finishResolvedTakeover(state);
    returnTimer = null;
    render();
  }, 1400);
}

function resizeStage(): void {
  const scale = Math.min(window.innerWidth / 480, window.innerHeight / 320);
  document.documentElement.style.setProperty("--stage-scale", scale.toFixed(4));
}

function updateClock(): void {
  app.querySelectorAll<HTMLElement>("[data-clock]").forEach((clock) => {
    clock.textContent = formatClock();
  });
}

const showcaseMotion = query.get("motion") === "showcase";
if (query.get("profile") === "pi" && !showcaseMotion) {
  document.documentElement.classList.add("pi-profile");
}
if (showcaseMotion) document.documentElement.classList.add("showcase-profile");

window.addEventListener("resize", resizeStage);
resizeStage();
render();
window.setInterval(updateClock, 1000);
if (!standalone) void api.start();
window.addEventListener("beforeunload", () => api.stop());
