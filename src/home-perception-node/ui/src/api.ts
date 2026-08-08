import type {
  MediaSettingsDraft,
  RemoteMediaInventory,
  RemoteMediaTestResult,
  RemoteSnapshot,
} from "./types";

interface ApiCallbacks {
  onSnapshot: (snapshot: RemoteSnapshot) => void;
  onConnection: (connected: boolean) => void;
  onError: (message: string) => void;
  onMediaInventory: (inventory: RemoteMediaInventory) => void;
}

interface SnapshotResponse {
  snapshot: RemoteSnapshot;
}

export class HomeNodeApi {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private stopped = true;
  private reconnectDelay = 1000;

  constructor(private readonly callbacks: ApiCallbacks) {}

  async start(): Promise<void> {
    this.stopped = false;
    try {
      await this.refresh();
    } catch {
      this.callbacks.onConnection(false);
    }
    this.connectWebSocket();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
  }

  async refresh(): Promise<void> {
    const snapshot = await this.request<RemoteSnapshot>("/api/state", "GET");
    this.callbacks.onConnection(true);
    this.callbacks.onSnapshot(snapshot);
  }

  async triggerMock(scenario: string): Promise<void> {
    const response = await this.request<SnapshotResponse>(`/api/mock/${encodeURIComponent(scenario)}`, "POST");
    this.callbacks.onSnapshot(response.snapshot);
  }

  async acknowledge(eventId: string): Promise<void> {
    const response = await this.request<SnapshotResponse>(`/api/events/${encodeURIComponent(eventId)}/ack`, "POST");
    this.callbacks.onSnapshot(response.snapshot);
  }

  async startVision(): Promise<void> {
    await this.request("/api/vision/start", "POST");
  }

  async stopVision(): Promise<void> {
    await this.request("/api/vision/stop", "POST");
  }

  async sampleAudio(): Promise<void> {
    await this.request("/api/audio/sample", "POST");
  }

  async loadMediaDevices(): Promise<void> {
    const inventory = await this.request<RemoteMediaInventory>("/api/local-devices/media", "GET");
    this.callbacks.onMediaInventory(inventory);
  }

  async refreshMediaDevices(): Promise<void> {
    const inventory = await this.request<RemoteMediaInventory>("/api/local-devices/refresh", "POST");
    this.callbacks.onMediaInventory(inventory);
  }

  async saveMediaSettings(settings: MediaSettingsDraft): Promise<void> {
    const inventory = await this.request<RemoteMediaInventory>("/api/settings/media", "POST", {
      camera_id: settings.cameraId,
      microphone_id: settings.microphoneId,
    });
    this.callbacks.onMediaInventory(inventory);
  }

  async testCamera(stableId: string | null): Promise<RemoteMediaTestResult> {
    return await this.request<RemoteMediaTestResult>("/api/vision/test", "POST", { stable_id: stableId });
  }

  async testMicrophone(stableId: string | null): Promise<RemoteMediaTestResult> {
    return await this.request<RemoteMediaTestResult>("/api/audio/test", "POST", { stable_id: stableId });
  }

  private connectWebSocket(): void {
    if (this.stopped) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
    this.socket.addEventListener("open", () => {
      this.reconnectDelay = 1000;
      this.callbacks.onConnection(true);
    });
    this.socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { kind?: string; snapshot?: RemoteSnapshot };
        if (message.snapshot) this.callbacks.onSnapshot(message.snapshot);
      } catch {
        this.callbacks.onError("本地服务返回了无法解析的数据");
      }
    });
    this.socket.addEventListener("close", () => {
      this.callbacks.onConnection(false);
      this.scheduleReconnect();
    });
    this.socket.addEventListener("error", () => this.socket?.close());
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 10_000);
  }

  private async request<T = Record<string, unknown>>(
    path: string,
    method: "GET" | "POST",
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(path, {
      method,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      let detail = `${response.status} ${response.statusText}`;
      try {
        const body = await response.json() as { detail?: string };
        if (body.detail) detail = body.detail;
      } catch {
        // Keep the HTTP status when the response is not JSON.
      }
      throw new Error(detail);
    }
    return await response.json() as T;
  }
}
