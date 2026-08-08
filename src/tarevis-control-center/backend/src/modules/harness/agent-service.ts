import type { HarnessConfig } from "../../config.js";
import type { AppLogger } from "../../core/logger.js";
import type {
  HarnessChatMessage,
  HarnessChatResult,
  HarnessProject,
  HarnessToolTrace,
} from "./harness-types.js";
import { InvalidHarnessInputError } from "./harness-types.js";
import type {
  HarnessModelClient,
  ModelMessage,
  ModelToolCall,
  ModelToolDefinition,
} from "./qwen-client.js";
import type { ProjectTools } from "./project-tools.js";

const MAX_HISTORY_MESSAGES = 12;
const MAX_MESSAGE_LENGTH = 8_000;
const MAX_TOOL_CALLS_PER_STEP = 8;

const TOOL_DEFINITIONS: ModelToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_directory",
      description: "List files and folders inside the selected project. Paths are relative to the project root.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative directory path. Use . for the project root." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a text file inside the selected project, optionally by line range.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path." },
          startLine: { type: "integer", minimum: 1 },
          endLine: { type: "integer", minimum: 1 },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search text across source files inside the selected project.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", minLength: 2 },
          path: { type: "string", description: "Relative directory path. Defaults to project root." },
          filePattern: { type: "string", description: "Optional wildcard such as *.ts or src/*.tsx." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
];

export class AgentService {
  constructor(
    private readonly modelClient: HarnessModelClient,
    private readonly tools: ProjectTools,
    private readonly config: HarnessConfig["qwen"],
    private readonly logger: AppLogger,
  ) {}

  getStatus(): { configured: boolean; model: string; provider: "qwen"; readOnly: true } {
    return {
      configured: this.modelClient.configured,
      model: this.modelClient.model,
      provider: "qwen",
      readOnly: true,
    };
  }

  async chat(
    project: HarnessProject,
    messageInput: unknown,
    historyInput: unknown,
  ): Promise<HarnessChatResult> {
    const message = parseMessage(messageInput, "message");
    const history = parseHistory(historyInput);
    const messages: ModelMessage[] = [
      { role: "system", content: buildSystemPrompt(project) },
      ...history,
      { role: "user", content: message },
    ];
    const traces: HarnessToolTrace[] = [];
    let usage: HarnessChatResult["usage"];

    for (let step = 0; step < this.config.maxSteps; step += 1) {
      const completion = await this.modelClient.complete(messages, TOOL_DEFINITIONS);
      usage = addUsage(usage, completion.usage);
      if (completion.toolCalls.length === 0) {
        return {
          reply: completion.content?.trim() || "模型没有返回可显示的内容。",
          model: this.modelClient.model,
          toolCalls: traces,
          usage,
        };
      }
      if (completion.toolCalls.length > MAX_TOOL_CALLS_PER_STEP) {
        throw new InvalidHarnessInputError(`Model requested too many tools in one step (${completion.toolCalls.length})`);
      }
      messages.push({
        role: "assistant",
        content: completion.content,
        tool_calls: completion.toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: { name: call.name, arguments: call.rawArguments },
        })),
      });
      for (const toolCall of completion.toolCalls) {
        const result = await this.executeTool(project, toolCall);
        traces.push(result.trace);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result.output),
        });
      }
    }

    this.logger.warn("harness.max_steps_reached", {
      projectId: project.id,
      maxSteps: this.config.maxSteps,
      toolCalls: traces.length,
    });
    return {
      reply: "已达到本轮项目检索的步骤上限。请缩小问题范围后继续。",
      model: this.modelClient.model,
      toolCalls: traces,
      usage,
    };
  }

  private async executeTool(
    project: HarnessProject,
    call: ModelToolCall,
  ): Promise<{ output: unknown; trace: HarnessToolTrace }> {
    try {
      let output: unknown;
      let summary: string;
      if (call.name === "list_directory") {
        const path = readOptionalString(call.arguments.path) ?? ".";
        const listing = await this.tools.listDirectory(project, path);
        output = listing;
        summary = `浏览 ${listing.path}，发现 ${listing.entries.length} 项`;
      } else if (call.name === "read_file") {
        const path = readRequiredString(call.arguments.path, "path");
        const file = await this.tools.readFile(project, path, {
          startLine: readOptionalInteger(call.arguments.startLine, "startLine"),
          endLine: readOptionalInteger(call.arguments.endLine, "endLine"),
        });
        output = file;
        summary = `读取 ${file.path} 第 ${file.startLine}-${file.endLine} 行`;
      } else if (call.name === "search_files") {
        const result = await this.tools.searchFiles(project, {
          query: readRequiredString(call.arguments.query, "query"),
          path: readOptionalString(call.arguments.path),
          filePattern: readOptionalString(call.arguments.filePattern),
        });
        output = result;
        summary = `搜索“${result.query}”，找到 ${result.matches.length} 处`;
      } else {
        throw new InvalidHarnessInputError(`Unknown tool: ${call.name}`);
      }
      this.logger.info("harness.tool_executed", {
        projectId: project.id,
        tool: call.name,
        ok: true,
      });
      return { output: { ok: true, result: output }, trace: { tool: call.name, input: call.arguments, summary, ok: true } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn("harness.tool_failed", {
        projectId: project.id,
        tool: call.name,
        error: message,
      });
      return {
        output: { ok: false, error: message },
        trace: { tool: call.name, input: call.arguments, summary: message, ok: false },
      };
    }
  }
}

function buildSystemPrompt(project: HarnessProject): string {
  return [
    "你是 TRAEVIS 控制中心内的只读项目分析 agent。",
    `当前项目名称：${project.name}`,
    "你可以使用目录浏览、文件读取和文本搜索工具来回答用户问题。",
    "所有工具路径都必须相对于当前项目根目录；不得猜测或访问项目外路径。",
    "先检查证据再回答，引用关键文件路径和行号。不要声称已经修改、运行或提交代码。",
    "回答使用与用户相同的语言，简洁说明结论、证据和仍不确定的部分。",
  ].join("\n");
}

function parseHistory(input: unknown): ModelMessage[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new InvalidHarnessInputError("history must be an array");
  return input.slice(-MAX_HISTORY_MESSAGES).map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new InvalidHarnessInputError(`Invalid history message at index ${index}`);
    }
    const record = item as Record<string, unknown>;
    if (record.role !== "user" && record.role !== "assistant") {
      throw new InvalidHarnessInputError(`Invalid history role at index ${index}`);
    }
    return {
      role: record.role,
      content: parseMessage(record.content, `history[${index}].content`),
    } satisfies HarnessChatMessage;
  });
}

function parseMessage(input: unknown, field: string): string {
  if (typeof input !== "string" || !input.trim() || input.trim().length > MAX_MESSAGE_LENGTH) {
    throw new InvalidHarnessInputError(`${field} must contain 1-${MAX_MESSAGE_LENGTH} characters`);
  }
  return input.trim();
}

function readRequiredString(input: unknown, field: string): string {
  const value = readOptionalString(input);
  if (value === undefined) throw new InvalidHarnessInputError(`${field} is required`);
  return value;
}

function readOptionalString(input: unknown): string | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "string" || !input.trim()) throw new InvalidHarnessInputError("Expected a non-empty string");
  return input.trim();
}

function readOptionalInteger(input: unknown, field: string): number | undefined {
  if (input === undefined) return undefined;
  if (!Number.isInteger(input) || (input as number) < 1) {
    throw new InvalidHarnessInputError(`${field} must be a positive integer`);
  }
  return input as number;
}

function addUsage(
  current: HarnessChatResult["usage"],
  next: HarnessChatResult["usage"],
): HarnessChatResult["usage"] {
  if (!next) return current;
  return {
    promptTokens: (current?.promptTokens ?? 0) + next.promptTokens,
    completionTokens: (current?.completionTokens ?? 0) + next.completionTokens,
    totalTokens: (current?.totalTokens ?? 0) + next.totalTokens,
  };
}
