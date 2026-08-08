import type { HarnessConfig } from "../../config.js";
import {
  HarnessModelNotConfiguredError,
  HarnessModelRequestError,
} from "./harness-types.js";

export interface ModelToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  rawArguments: string;
}

export type ModelMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }> }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ModelCompletion {
  content: string | null;
  toolCalls: ModelToolCall[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface HarnessModelClient {
  readonly model: string;
  readonly configured: boolean;
  complete(messages: ModelMessage[], tools: ModelToolDefinition[]): Promise<ModelCompletion>;
}

export class QwenClient implements HarnessModelClient {
  readonly model: string;
  readonly configured: boolean;

  constructor(private readonly config: HarnessConfig["qwen"]) {
    this.model = config.model;
    this.configured = Boolean(config.apiKey);
  }

  async complete(messages: ModelMessage[], tools: ModelToolDefinition[]): Promise<ModelCompletion> {
    if (!this.config.apiKey) {
      throw new HarnessModelNotConfiguredError("QWEN_API_KEY is not configured on the backend");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          tools,
          tool_choice: "auto",
          temperature: 0.2,
          max_tokens: 4_096,
        }),
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new HarnessModelRequestError(
          `Qwen request failed with HTTP ${response.status}: ${sanitizeProviderError(raw)}`,
        );
      }
      let body: unknown;
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        throw new HarnessModelRequestError("Qwen returned invalid JSON");
      }
      return parseCompletion(body);
    } catch (error) {
      if (error instanceof HarnessModelRequestError || error instanceof HarnessModelNotConfiguredError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new HarnessModelRequestError(`Qwen request timed out after ${this.config.timeoutMs}ms`);
      }
      throw new HarnessModelRequestError(
        `Qwen request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parseCompletion(input: unknown): ModelCompletion {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HarnessModelRequestError("Qwen returned an incompatible response");
  }
  const body = input as Record<string, unknown>;
  const choices = body.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") {
    throw new HarnessModelRequestError("Qwen response did not include a choice");
  }
  const message = (choices[0] as Record<string, unknown>).message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new HarnessModelRequestError("Qwen response did not include an assistant message");
  }
  const record = message as Record<string, unknown>;
  const content = typeof record.content === "string" ? record.content : null;
  const rawToolCalls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
  const toolCalls = rawToolCalls.map((toolCall, index) => parseToolCall(toolCall, index));
  if (!content?.trim() && toolCalls.length === 0) {
    throw new HarnessModelRequestError("Qwen returned neither content nor tool calls");
  }
  return { content, toolCalls, usage: parseUsage(body.usage) };
}

function parseToolCall(input: unknown, index: number): ModelToolCall {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HarnessModelRequestError(`Invalid tool call at index ${index}`);
  }
  const record = input as Record<string, unknown>;
  const fn = record.function;
  if (typeof record.id !== "string" || !fn || typeof fn !== "object" || Array.isArray(fn)) {
    throw new HarnessModelRequestError(`Invalid tool call at index ${index}`);
  }
  const functionRecord = fn as Record<string, unknown>;
  if (typeof functionRecord.name !== "string") {
    throw new HarnessModelRequestError(`Invalid tool name at index ${index}`);
  }
  const rawArguments = typeof functionRecord.arguments === "string" ? functionRecord.arguments : "{}";
  let args: unknown;
  try {
    args = JSON.parse(rawArguments) as unknown;
  } catch {
    throw new HarnessModelRequestError(`Tool arguments are not valid JSON: ${functionRecord.name}`);
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new HarnessModelRequestError(`Tool arguments must be an object: ${functionRecord.name}`);
  }
  return {
    id: record.id,
    name: functionRecord.name,
    arguments: args as Record<string, unknown>,
    rawArguments,
  };
}

function parseUsage(input: unknown): ModelCompletion["usage"] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  const promptTokens = toTokenCount(record.prompt_tokens);
  const completionTokens = toTokenCount(record.completion_tokens);
  const totalTokens = toTokenCount(record.total_tokens) || promptTokens + completionTokens;
  if (!promptTokens && !completionTokens && !totalTokens) return undefined;
  return { promptTokens, completionTokens, totalTokens };
}

function toTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function sanitizeProviderError(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500) || "empty response";
}
