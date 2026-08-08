export interface HarnessStatus {
  configured: boolean;
  model: string;
  provider: "qwen";
  readOnly: true;
  projectCount: number;
}

export interface HarnessProject {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  size?: number;
  modifiedAt: string;
}

export interface DirectoryListing {
  projectId: string;
  path: string;
  entries: ProjectEntry[];
  truncated: boolean;
}

export interface FileContent {
  projectId: string;
  path: string;
  content: string;
  size: number;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
}

export interface HarnessChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface HarnessToolTrace {
  tool: string;
  input: Record<string, unknown>;
  summary: string;
  ok: boolean;
}

export interface HarnessChatResult {
  reply: string;
  model: string;
  toolCalls: HarnessToolTrace[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

class HarnessClient {
  constructor(
    private readonly apiBase = "/",
    private readonly deviceId = import.meta.env.VITE_CONTROL_CENTER_DEVICE_ID?.trim() || "my-computer",
  ) {}

  getStatus(): Promise<HarnessStatus> {
    return this.request("api/harness/status");
  }

  async listProjects(): Promise<HarnessProject[]> {
    const body = await this.request<{ projects: HarnessProject[] }>("api/harness/projects");
    return body.projects;
  }

  async createProject(input: { name: string; path: string }): Promise<HarnessProject> {
    const body = await this.request<{ project: HarnessProject }>("api/harness/projects", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return body.project;
  }

  async updateProject(projectId: string, input: { name: string; path: string }): Promise<HarnessProject> {
    const body = await this.request<{ project: HarnessProject }>(
      `api/harness/projects/${encodeURIComponent(projectId)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    return body.project;
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.request(`api/harness/projects/${encodeURIComponent(projectId)}`, { method: "DELETE" });
  }

  listDirectory(projectId: string, path = "."): Promise<DirectoryListing> {
    const query = new URLSearchParams({ path });
    return this.request(`api/harness/projects/${encodeURIComponent(projectId)}/tree?${query}`);
  }

  readFile(projectId: string, path: string): Promise<FileContent> {
    const query = new URLSearchParams({ path });
    return this.request(`api/harness/projects/${encodeURIComponent(projectId)}/file?${query}`);
  }

  chat(input: {
    projectId: string;
    message: string;
    history: HarnessChatMessage[];
  }): Promise<HarnessChatResult> {
    return this.request("api/harness/chat", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(this.httpUrl(path), {
      ...init,
      credentials: "include",
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(await this.errorMessage(response));
    }
    return response.json() as Promise<T>;
  }

  private httpUrl(path: string): string {
    return controlCenterHttpUrl(this.apiBase, path, this.deviceId, window.location.origin);
  }

  private async errorMessage(response: Response): Promise<string> {
    try {
      const body = await response.json() as { error?: { code?: unknown; message?: unknown } };
      switch (body.error?.code) {
        case "COMPUTER_OFFLINE": return "本地电脑离线，当前不能执行 Harness 操作。";
        case "RELAY_TIMEOUT": return "请求超时，执行结果未知，请检查状态后再重试。";
        case "INVALID_DEVICE": return "当前设备配置无效，请检查 deviceId。";
        case "UNAUTHORIZED": return "Cloudflare Access 未认证，请重新登录。";
      }
      if (typeof body.error?.message === "string") return body.error.message;
    } catch {
      // Fall back to the status below when the backend did not return JSON.
    }
    return `Harness request failed (HTTP ${response.status})`;
  }
}

export const harnessClient = new HarnessClient(import.meta.env.VITE_CONTROL_CENTER_API_BASE ?? "/");
import { controlCenterHttpUrl } from "../control/endpoints";
