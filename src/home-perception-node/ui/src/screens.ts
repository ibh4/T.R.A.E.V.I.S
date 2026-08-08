import { audioBars, streamLines, telemetryStreamLines } from "./demo-data";
import { demoScenarios } from "./demo-scenarios";
import { avatarMarkup } from "./avatar";
import { escapeHtml } from "./escape";
import { formatEventTime, formatUptime, percent, sensorLabel } from "./format";
import type { AppState, HomeEvent, MediaDeviceInfo, PageId } from "./types";

const pageLabels: Record<PageId, { label: string; icon: string }> = {
  guard: { label: "守护", icon: "house" },
  vision: { label: "视觉", icon: "eye" },
  audio: { label: "声音", icon: "audio-lines" },
  events: { label: "事件", icon: "bell-ring" },
  device: { label: "设备", icon: "cpu" },
};

export function appMarkup(state: AppState): string {
  const snapshot = state.snapshot;
  const connectionLabel = snapshot.connected ? "LOCAL LINK" : "UI DEMO";
  const connectionClass = snapshot.connected ? "is-online" : "is-demo";

  return `
    <main class="device-shell page-${state.page} severity-${state.severity}" data-page="${state.page}">
      <div class="ambient-grid" aria-hidden="true"></div>
      <header class="top-rail">
        <div class="node-identity">
          <span class="node-kicker">HOME NODE / ${escapeHtml(snapshot.deviceId.toUpperCase())}</span>
          <button class="link-state ${connectionClass}" type="button" data-action="toggle-demo" title="打开模拟输入">
            <span class="status-dot"></span>${connectionLabel}
          </button>
        </div>
        <div class="clock-block">
          <span class="clock" data-clock>00:00:00</span>
          <span class="clock-caption">LOCAL / 480x320</span>
        </div>
      </header>

      <section class="screen" aria-label="${pageLabels[state.page].label}">
        ${screenMarkup(state)}
      </section>

      <nav class="bottom-nav" aria-label="主要页面">
        ${navigationMarkup(state)}
      </nav>
      ${state.notice ? `<div class="notice-bar" role="status"><i data-lucide="circle-alert" aria-hidden="true"></i><span>${escapeHtml(state.notice)}</span></div>` : ""}
      ${state.demoPanelOpen ? demoPanelMarkup() : ""}
    </main>
  `;
}

function screenMarkup(state: AppState): string {
  switch (state.page) {
    case "guard":
      return guardMarkup(state);
    case "vision":
      return visionMarkup(state);
    case "audio":
      return audioMarkup(state);
    case "events":
      return eventsMarkup(state);
    case "device":
      return deviceMarkup(state);
  }
}

function navigationMarkup(state: AppState): string {
  const unresolvedCount = state.snapshot.events.filter((event) => !event.resolved).length;
  return (Object.entries(pageLabels) as [PageId, { label: string; icon: string }][]).map(
      ([id, item]) => `
        <button class="nav-button ${id === state.page ? "active" : ""}" type="button" data-nav="${id}" aria-pressed="${id === state.page}">
          <i data-lucide="${item.icon}" aria-hidden="true"></i>
          <span>${item.label}</span>
          ${id === "events" && unresolvedCount > 0 ? `<small class="nav-count">${Math.min(unresolvedCount, 9)}</small>` : ""}
        </button>
      `,
    )
    .join("");
}

function demoPanelMarkup(): string {
  return `
    <button class="demo-backdrop" type="button" data-action="close-demo" aria-label="关闭模拟输入"></button>
    <aside class="demo-panel" aria-label="模拟输入">
      <header>
        <div><span>LOCAL TEST</span><strong>模拟输入</strong></div>
        <button type="button" data-action="close-demo" title="关闭" aria-label="关闭模拟输入"><i data-lucide="x" aria-hidden="true"></i></button>
      </header>
      <div class="demo-grid">
        ${demoScenarios.map((scenario) => `
          <button type="button" data-demo="${scenario.id}">
            <i data-lucide="${scenario.icon}" aria-hidden="true"></i>
            <span>${scenario.label}</span>
          </button>
        `).join("")}
      </div>
      <footer>EVENT CONTRACT / SCHEMA 1.0</footer>
    </aside>
  `;
}

function guardMarkup(state: AppState): string {
  const { snapshot } = state;
  const latest = snapshot.events[0];
  const mainTitle = state.severity === "critical" ? "需要确认" : state.severity === "resolved" ? "事件已处理" : "家庭守护中";
  const mainState = state.severity === "critical" ? "ALERT" : state.severity === "resolved" ? "RESOLVED" : "READY";
  const leftStream = [
    `CAM_${snapshot.camera.toUpperCase()} :: ${snapshot.visionFps.toFixed(1)}FPS`,
    `MIC_${snapshot.microphone.toUpperCase()} :: ${Math.round(snapshot.audioLevel * 100)}LVL`,
    `EVENTS :: ${snapshot.events.length.toString().padStart(2, "0")}`,
    ...streamLines,
  ];
  const rightStream = [
    `UPTIME :: ${snapshot.uptimeSeconds.toString().padStart(5, "0")}`,
    `MOTION :: ${Math.round(snapshot.motionScore * 1000).toString().padStart(3, "0")}`,
    ...telemetryStreamLines,
  ];

  return `
    <div class="guard-grid">
      <aside class="stream-panel stream-panel-left">
        <div class="panel-heading"><span>EVENT STREAM</span><strong>HOME</strong></div>
        ${codeWaterfallMarkup(leftStream)}
        <span class="stream-count">${snapshot.events.length.toString().padStart(2, "0")} EVT</span>
      </aside>

      <div class="avatar-stage">
        <div class="stage-label stage-label-top"><span>DESIGNATION</span><strong>TAREVIS.01</strong></div>
        <div class="radar-sweep" aria-hidden="true"></div>
        <div class="hud-ping" aria-hidden="true"></div>
        <div class="hud-square" aria-hidden="true"><span></span><span></span><i class="hud-scan"></i></div>
        <div class="orbit orbit-one" aria-hidden="true"><span></span></div>
        <div class="orbit orbit-two" aria-hidden="true"><span></span></div>
        <div class="orbit orbit-three" aria-hidden="true"><span></span></div>
        ${avatarMarkup(state.mood)}
        <div class="guard-copy">
          <strong>${mainTitle}</strong>
          <span>${mainState} / LOCAL GUARD</span>
        </div>
      </div>

      <aside class="stream-panel telemetry-panel">
        <div class="panel-heading"><span>SENSOR NODE</span><strong>${snapshot.connected ? "ONLINE" : "DEMO"}</strong></div>
        ${telemetryRow("CAM", sensorLabel(snapshot.camera), snapshot.camera === "active" ? 1 : 0.35)}
        ${telemetryRow("MIC", sensorLabel(snapshot.microphone), snapshot.microphone === "active" ? 1 : 0.35)}
        ${telemetryRow("FPS", snapshot.visionFps.toFixed(1), Math.min(snapshot.visionFps / 10, 1))}
        ${codeWaterfallMarkup(rightStream, true, true)}
        <div class="latest-mini">
          <span>LAST EVENT</span>
          <strong>${latest ? escapeHtml(latest.title) : "暂无事件"}</strong>
        </div>
      </aside>
    </div>
  `;
}

function codeWaterfallMarkup(lines: string[], reverse = false, compact = false): string {
  const track = lines.map((line, index) => `<span style="--line:${index}">&gt; ${escapeHtml(line)}</span>`).join("");
  return `
    <div class="code-waterfall ${reverse ? "reverse" : ""} ${compact ? "compact" : ""}" aria-hidden="true">
      <div class="code-reel">
        <div class="code-track">${track}</div>
        <div class="code-track">${track}</div>
      </div>
    </div>
  `;
}

function visionMarkup(state: AppState): string {
  const { snapshot } = state;
  const cameraActive = snapshot.camera === "active";
  const fallEvent = snapshot.events.find((event) => event.type === "fall_suspected" && !event.resolved);
  const poseFallen = Boolean(fallEvent);
  const cameraLabelZh: Record<string, string> = {
    ready: "就绪",
    active: "激活",
    standby: "待机",
    offline: "离线",
  };
  return `
    <div class="vision-grid">
      <section class="camera-panel cut-panel vision-center">
        <div class="camera-heading"><span>摄像头视图</span><strong>CSI-01</strong></div>
        <div class="camera-window ${snapshot.previewUrl ? "has-feed" : ""}">
          ${snapshot.previewUrl ? `<img src="${escapeHtml(snapshot.previewUrl)}" alt="摄像头实时姿势识别" />` : cameraStandbyMarkup()}
          <span class="camera-scanline" aria-hidden="true"></span>
          <span class="reticle reticle-a"></span><span class="reticle reticle-b"></span>
        </div>
        <div class="pose-status ${poseFallen ? "is-fallen" : "is-normal"}">
          ${poseFallen
            ? `<strong>摔倒</strong>`
            : `<span class="pose-dot" aria-hidden="true"></span><strong>姿态正常</strong>`}
        </div>
        <div class="vision-metrics-inline">
          ${metric("帧率", snapshot.visionFps ? `${snapshot.visionFps.toFixed(1)} FPS` : "-- FPS")}
          ${metric("推理", snapshot.inferenceMs === null ? "-- MS" : `${snapshot.inferenceMs} MS`)}
          ${metric("运动", percent(snapshot.motionScore))}
        </div>
      </section>

      <aside class="vision-core-aside cut-panel">
        <div class="sensor-circle ${cameraActive ? "is-active" : ""}">
          <div class="sensor-ticks" aria-hidden="true"></div>
          <div class="sensor-sweep" aria-hidden="true"></div>
          <span class="sensor-node sensor-node-a" aria-hidden="true"></span>
          <span class="sensor-node sensor-node-b" aria-hidden="true"></span>
          <span class="sensor-node sensor-node-c" aria-hidden="true"></span>
          ${avatarMarkup(cameraActive ? "thinking" : state.mood, "TRAE 视觉助手")}
        </div>
        <div class="vision-status">
          <span>视觉状态</span>
          <strong>${cameraActive ? "视觉感知中" : "视觉待机"}</strong>
        </div>
        <div class="vision-metrics-side">
          ${metric("摄像头", cameraLabelZh[snapshot.camera] ?? sensorLabel(snapshot.camera))}
        </div>
        <button class="panel-command" type="button" data-action="toggle-camera">
          <i data-lucide="${cameraActive ? "square" : "play"}" aria-hidden="true"></i>
          <span>${cameraActive ? "停止预览" : "启动预览"}</span>
        </button>
      </aside>
    </div>
  `;
}

function audioMarkup(state: AppState): string {
  const { snapshot } = state;
  const listening = snapshot.microphone === "active";
  const bars = audioBars.map((height, index) => `<span style="--bar:${height + (listening ? (index % 3) * 8 : 0)}%;--wave-delay:${(-index * 0.07).toFixed(2)}s"></span>`).join("");
  return `
    <div class="audio-crt">
      <section class="audio-hero">
        <span class="audio-kicker">AUDIO NODE / LOCAL</span>
        <strong class="audio-word">${listening ? "LISTEN" : "READY"}</strong>
        <div class="audio-level-row"><strong>${Math.round(snapshot.audioLevel * 100)}%</strong><span>INPUT LEVEL</span></div>
      </section>

      <section class="audio-status">
        <div class="audio-status-heading">
          <strong>${listening ? "声音感知中" : "声音待机"}</strong>
          <span class="square-pulse ${listening ? "active" : ""}"></span>
        </div>
        <div class="wave-bars ${listening ? "is-active" : ""}" aria-label="音频输入电平">${bars}</div>
        <div class="audio-copy">
          <span>MIC ${sensorLabel(snapshot.microphone)}</span>
          <span>KEYWORD ${percent(snapshot.keywordConfidence)}</span>
          <strong>${escapeHtml(snapshot.lastTranscript ?? "等待本地音频输入")}</strong>
        </div>
        <button class="crt-command" type="button" data-action="toggle-audio">
          <i data-lucide="${listening ? "square" : "mic"}" aria-hidden="true"></i>
          <span>${listening ? "停止采样" : "开始采样"}</span>
        </button>
      </section>
      <div class="audio-ticker"><div class="ticker-reel"><span>LOCAL PROCESSING // HELP KEYWORD // USER ACK // PCM 16KHZ // NO CLOUD REQUIRED</span><span aria-hidden="true">LOCAL PROCESSING // HELP KEYWORD // USER ACK // PCM 16KHZ // NO CLOUD REQUIRED</span></div></div>
    </div>
  `;
}

function eventsMarkup(state: AppState): string {
  const events = state.snapshot.events;
  const selected = events.find((event) => event.id === state.selectedEventId) ?? events[0];

  return `
    <div class="events-grid">
      <section class="event-list-panel">
        <div class="event-list-heading"><span>HOME EVENTS</span><strong>${events.length.toString().padStart(2, "0")}</strong></div>
        <div class="event-list">
          ${events.slice(0, 4).map((event) => eventRowMarkup(event, selected?.id === event.id)).join("")}
        </div>
      </section>
      <section class="event-detail level-${selected?.level ?? "info"} ${selected?.snapshotUrl ? "has-snapshot" : ""}">
        ${selected ? eventDetailMarkup(selected) : emptyEventMarkup()}
      </section>
    </div>
  `;
}

function deviceMarkup(state: AppState): string {
  const { snapshot } = state;
  const connection = snapshot.connected ? "CONNECTED" : "UI DEMO";
  return `
    <div class="device-grid">
      <div class="device-titlebar">
        <strong>TAREVIS // HOME NODE</strong>
        <div class="device-title-actions">
          <span>LINK [ ${connection} ]</span>
          <button type="button" data-action="open-media-settings" title="设备设置" aria-label="打开设备设置">
            <i data-lucide="settings" aria-hidden="true"></i>
          </button>
        </div>
      </div>
      <section class="device-modules">
        ${deviceModule("camera", "摄像头", sensorLabel(snapshot.camera), snapshot.camera !== "offline")}
        ${deviceModule("mic", "麦克风", sensorLabel(snapshot.microphone), snapshot.microphone !== "offline")}
        ${deviceModule("activity", "视觉帧率", snapshot.visionFps ? `${snapshot.visionFps.toFixed(1)} FPS` : "待连接", snapshot.visionFps > 0)}
        ${deviceModule("thermometer", "CPU 温度", snapshot.cpuTemp === null ? "待连接" : `${snapshot.cpuTemp.toFixed(1)} C`, snapshot.cpuTemp !== null)}
        ${deviceModule("clock-3", "运行时间", formatUptime(snapshot.uptimeSeconds), true)}
        ${deviceModule("shield-check", "事件契约", "SCHEMA 1.0", true)}
      </section>
      <div class="device-footer">
        <div class="device-bars" aria-hidden="true">${[42, 68, 35, 82, 54, 74, 46, 90].map((height, index) => `<span style="--device-bar:${height}%;--meter-delay:${(-index * 0.11).toFixed(2)}s"></span>`).join("")}</div>
        <div class="device-summary ${snapshot.lastError ? "has-error" : ""}">
          <span>LOCAL RUNTIME</span>
          <strong>${snapshot.lastError ? escapeHtml(snapshot.lastError) : snapshot.connected ? "感知服务已连接" : "等待本地服务"}</strong>
        </div>
        <button class="icon-command" type="button" data-action="refresh" title="刷新连接" aria-label="刷新连接">
          <i data-lucide="rotate-cw" aria-hidden="true"></i>
        </button>
      </div>
      ${state.mediaSettingsOpen ? mediaSettingsMarkup(state) : ""}
    </div>
  `;
}

function mediaSettingsMarkup(state: AppState): string {
  const inventory = state.mediaInventory;
  const cameras = inventory?.cameras ?? [];
  const microphones = inventory?.microphones ?? [];
  const status = state.mediaBusy
    ? "正在访问本机设备..."
    : inventory?.warnings[0]
      ? inventory.warnings[0]
      : inventory
        ? `已发现 ${cameras.length} 个摄像头 / ${microphones.length} 个麦克风`
        : "连接本地服务后扫描设备";
  return `
    <section class="media-settings-panel" role="dialog" aria-modal="true" aria-label="音视频设备设置">
      <header class="media-settings-heading">
        <div><span>LOCAL MEDIA</span><strong>设备设置</strong></div>
        <div class="media-heading-actions">
          <button type="button" data-action="scan-media" title="重新扫描" aria-label="重新扫描设备" ${state.mediaBusy ? "disabled" : ""}>
            <i data-lucide="rotate-cw" aria-hidden="true"></i>
          </button>
          <button type="button" data-action="close-media-settings" title="关闭" aria-label="关闭设备设置" ${state.mediaBusy ? "disabled" : ""}>
            <i data-lucide="x" aria-hidden="true"></i>
          </button>
        </div>
      </header>
      ${mediaDeviceRow("camera", "摄像头", cameras, state.mediaDraft.cameraId, state.mediaBusy)}
      ${mediaDeviceRow("microphone", "麦克风", microphones, state.mediaDraft.microphoneId, state.mediaBusy)}
      <div class="media-settings-status" role="status">
        <span class="status-dot"></span><strong>${escapeHtml(status)}</strong>
      </div>
      <button class="media-save-command" type="button" data-action="save-media" ${state.mediaBusy || !inventory ? "disabled" : ""}>
        <i data-lucide="save" aria-hidden="true"></i><span>应用设备配置</span>
      </button>
    </section>
  `;
}

function mediaDeviceRow(
  kind: "camera" | "microphone",
  label: string,
  devices: MediaDeviceInfo[],
  selectedId: string | null,
  busy: boolean,
): string {
  const icon = kind === "camera" ? "camera" : "mic";
  const testAction = kind === "camera" ? "test-camera" : "test-microphone";
  const options = devices.map((device) => `
    <option value="${escapeHtml(device.stableId)}" ${device.stableId === selectedId ? "selected" : ""}>
      ${escapeHtml(device.name)}
    </option>
  `).join("");
  return `
    <div class="media-device-row">
      <label for="media-${kind}"><i data-lucide="${icon}" aria-hidden="true"></i><span>${label}</span></label>
      <select id="media-${kind}" data-media-device="${kind}" ${busy ? "disabled" : ""}>
        <option value="">自动选择</option>
        ${options}
      </select>
      <button type="button" data-action="${testAction}" ${busy || !selectedId ? "disabled" : ""}>测试</button>
    </div>
  `;
}

function telemetryRow(label: string, value: string, fill: number): string {
  return `
    <div class="telemetry-row">
      <div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>
      <span class="telemetry-track"><i style="--fill:${Math.max(0, Math.min(fill, 1)) * 100}%"></i></span>
    </div>
  `;
}

function metric(label: string, value: string): string {
  return `<div class="metric"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function cameraStandbyMarkup(): string {
  return `
    <div class="camera-standby">
      <i data-lucide="camera" aria-hidden="true"></i>
      <span>PREVIEW STANDBY</span>
    </div>
  `;
}

function eventRowMarkup(event: HomeEvent, active: boolean): string {
  return `
    <button class="event-row ${active ? "active" : ""} level-${event.level}" type="button" data-event-id="${escapeHtml(event.id)}">
      <span class="event-source">${escapeHtml(event.source.toUpperCase())}</span>
      <strong>${escapeHtml(event.title)}</strong>
      <time>${formatEventTime(event.occurredAt)}</time>
    </button>
  `;
}

function eventDetailMarkup(event: HomeEvent): string {
  const icon = event.resolved ? "check-circle-2" : event.level === "high" ? "alert-triangle" : "activity";
  return `
    <div class="event-symbol"><i data-lucide="${icon}" aria-hidden="true"></i></div>
    <div class="event-detail-copy">
      <span>${escapeHtml(event.zone.toUpperCase())} / ${escapeHtml(event.type.toUpperCase())}</span>
      <strong>${escapeHtml(event.title)}</strong>
      <p>${escapeHtml(event.detail)}</p>
      <small>CONFIDENCE ${percent(event.confidence ?? null)}</small>
    </div>
    ${event.snapshotUrl ? `<img class="event-snapshot" src="${escapeHtml(event.snapshotUrl)}" alt="事件触发抓拍" />` : ""}
    <button class="resolve-command" type="button" data-action="resolve-event" ${event.resolved ? "disabled" : ""}>
      <i data-lucide="check-circle-2" aria-hidden="true"></i>
      <span>${event.resolved ? "已处理" : "确认已处理"}</span>
    </button>
  `;
}

function emptyEventMarkup(): string {
  return `<div class="event-empty"><i data-lucide="bell-ring" aria-hidden="true"></i><strong>暂无家庭事件</strong></div>`;
}

function deviceModule(icon: string, label: string, value: string, ready: boolean): string {
  return `
    <div class="device-module ${ready ? "ready" : "standby"}">
      <i data-lucide="${icon}" aria-hidden="true"></i>
      <span>${label}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}
