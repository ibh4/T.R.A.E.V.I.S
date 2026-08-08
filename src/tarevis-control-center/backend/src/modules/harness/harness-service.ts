import type { HarnessConfig } from "../../config.js";
import type { AppLogger } from "../../core/logger.js";
import { AgentService } from "./agent-service.js";
import type { HarnessChatResult } from "./harness-types.js";
import { InvalidHarnessInputError } from "./harness-types.js";
import { ProjectRegistry } from "./project-registry.js";
import { ProjectTools } from "./project-tools.js";
import { QwenClient } from "./qwen-client.js";

export class HarnessService {
  readonly registry: ProjectRegistry;
  readonly tools: ProjectTools;
  readonly agent: AgentService;

  constructor(readonly config: HarnessConfig, logger: AppLogger) {
    this.registry = new ProjectRegistry({
      filePath: config.projectsFile,
      defaultProjectPath: config.defaultProjectPath,
    });
    this.tools = new ProjectTools();
    this.agent = new AgentService(new QwenClient(config.qwen), this.tools, config.qwen, logger);
  }

  async getStatus() {
    const projects = await this.registry.list();
    return { ...this.agent.getStatus(), projectCount: projects.length };
  }

  async chat(input: unknown): Promise<HarnessChatResult> {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw new InvalidHarnessInputError("Chat body must be an object");
    }
    const record = input as Record<string, unknown>;
    if (typeof record.projectId !== "string" || !record.projectId.trim()) {
      throw new InvalidHarnessInputError("projectId is required");
    }
    const project = await this.registry.get(record.projectId.trim());
    return this.agent.chat(project, record.message, record.history);
  }
}
