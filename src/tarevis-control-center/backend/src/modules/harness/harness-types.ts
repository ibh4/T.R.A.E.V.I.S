export interface HarnessProject {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export type ProjectEntryType = "directory" | "file";

export interface ProjectEntry {
  name: string;
  path: string;
  type: ProjectEntryType;
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

export interface SearchMatch {
  path: string;
  line: number;
  preview: string;
}

export interface SearchResult {
  projectId: string;
  query: string;
  matches: SearchMatch[];
  scannedFiles: number;
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

export class InvalidHarnessInputError extends Error {}
export class HarnessProjectNotFoundError extends Error {}
export class HarnessPathAccessError extends Error {}
export class HarnessFileNotFoundError extends Error {}
export class HarnessModelNotConfiguredError extends Error {}
export class HarnessModelRequestError extends Error {}
