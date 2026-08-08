import assert from "node:assert/strict";
import test from "node:test";
import { noopLogger } from "../../src/core/logger.js";
import { AgentService } from "../../src/modules/harness/agent-service.js";
import type { HarnessProject } from "../../src/modules/harness/harness-types.js";
import type {
  HarnessModelClient,
  ModelCompletion,
  ModelMessage,
  ModelToolDefinition,
} from "../../src/modules/harness/qwen-client.js";
import type { ProjectTools } from "../../src/modules/harness/project-tools.js";

class SequenceModelClient implements HarnessModelClient {
  readonly model = "qwen-test";
  readonly configured = true;
  readonly calls: ModelMessage[][] = [];
  private index = 0;

  constructor(private readonly completions: ModelCompletion[]) {}

  async complete(messages: ModelMessage[], _tools: ModelToolDefinition[]): Promise<ModelCompletion> {
    this.calls.push(structuredClone(messages));
    return this.completions[this.index++];
  }
}

test("agent loop executes model tool calls and returns the grounded final answer", async () => {
  const model = new SequenceModelClient([
    {
      content: null,
      toolCalls: [{
        id: "call-1",
        name: "list_directory",
        arguments: { path: "." },
        rawArguments: '{"path":"."}',
      }],
      usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
    },
    {
      content: "项目根目录包含 README.md。",
      toolCalls: [],
      usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25 },
    },
  ]);
  const tools = {
    listDirectory: async () => ({
      projectId: "project",
      path: ".",
      entries: [{
        name: "README.md",
        path: "README.md",
        type: "file" as const,
        size: 12,
        modifiedAt: "2026-08-04T00:00:00.000Z",
      }],
      truncated: false,
    }),
  } as unknown as ProjectTools;
  const service = new AgentService(model, tools, {
    baseUrl: "https://example.invalid/v1",
    model: "qwen-test",
    timeoutMs: 5_000,
    maxSteps: 3,
  }, noopLogger);
  const project: HarnessProject = {
    id: "project",
    name: "Project",
    path: "C:\\project",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
  };

  const result = await service.chat(project, "根目录有什么？", []);
  assert.equal(result.reply, "项目根目录包含 README.md。");
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].summary, "浏览 .，发现 1 项");
  assert.deepEqual(result.usage, { promptTokens: 30, completionTokens: 7, totalTokens: 37 });
  assert.equal(model.calls.length, 2);
  assert.equal(model.calls[1].at(-1)?.role, "tool");
});
