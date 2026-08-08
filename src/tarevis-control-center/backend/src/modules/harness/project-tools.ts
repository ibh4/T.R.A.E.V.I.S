import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  DirectoryListing,
  FileContent,
  HarnessProject,
  ProjectEntry,
  SearchMatch,
  SearchResult,
} from "./harness-types.js";
import {
  HarnessFileNotFoundError,
  HarnessPathAccessError,
  InvalidHarnessInputError,
} from "./harness-types.js";

const MAX_DIRECTORY_ENTRIES = 300;
const MAX_FILE_BYTES = 256 * 1_024;
const MAX_FILE_LINES = 400;
const MAX_SEARCH_FILES = 2_000;
const MAX_SEARCH_RESULTS = 60;
const MAX_SEARCH_DEPTH = 12;
const IGNORED_DIRECTORIES = new Set([
  ".agents",
  ".git",
  ".idea",
  ".next",
  ".venv",
  ".vscode",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const TEXT_EXTENSIONS = new Set([
  ".c", ".cc", ".cfg", ".conf", ".cpp", ".css", ".csv", ".env", ".go",
  ".h", ".hpp", ".html", ".ini", ".java", ".js", ".json", ".jsx", ".md",
  ".mjs", ".py", ".rs", ".sh", ".sql", ".toml", ".ts", ".tsx", ".txt",
  ".xml", ".yaml", ".yml",
]);

export class ProjectTools {
  async listDirectory(project: HarnessProject, requestedPath = "."): Promise<DirectoryListing> {
    const target = await resolveProjectPath(project, requestedPath);
    const targetStat = await stat(target.absolute);
    if (!targetStat.isDirectory()) {
      throw new InvalidHarnessInputError(`Path is not a directory: ${target.relative}`);
    }
    const dirents = await readdir(target.absolute, { withFileTypes: true });
    const entries: ProjectEntry[] = [];
    for (const dirent of dirents) {
      if (IGNORED_DIRECTORIES.has(dirent.name)) continue;
      const childRequestedPath = toProjectPath(join(target.relative, dirent.name));
      let child;
      try {
        child = await resolveProjectPath(project, childRequestedPath);
      } catch (error) {
        if (error instanceof HarnessPathAccessError || error instanceof HarnessFileNotFoundError) continue;
        throw error;
      }
      const childStat = await stat(child.absolute);
      if (!childStat.isDirectory() && !childStat.isFile()) continue;
      entries.push({
        name: dirent.name,
        path: child.relative,
        type: childStat.isDirectory() ? "directory" : "file",
        size: childStat.isFile() ? childStat.size : undefined,
        modifiedAt: childStat.mtime.toISOString(),
      });
    }
    entries.sort((left, right) => (
      left.type === right.type
        ? left.name.localeCompare(right.name, "zh-CN")
        : left.type === "directory" ? -1 : 1
    ));
    return {
      projectId: project.id,
      path: target.relative,
      entries: entries.slice(0, MAX_DIRECTORY_ENTRIES),
      truncated: entries.length > MAX_DIRECTORY_ENTRIES,
    };
  }

  async readFile(
    project: HarnessProject,
    requestedPath: string,
    options: { startLine?: number; endLine?: number } = {},
  ): Promise<FileContent> {
    const target = await resolveProjectPath(project, requestedPath);
    const info = await stat(target.absolute);
    if (!info.isFile()) throw new InvalidHarnessInputError(`Path is not a file: ${target.relative}`);
    if (info.size > MAX_FILE_BYTES) {
      throw new InvalidHarnessInputError(`File exceeds ${MAX_FILE_BYTES} byte read limit: ${target.relative}`);
    }
    const buffer = await readFile(target.absolute);
    if (buffer.includes(0)) {
      throw new InvalidHarnessInputError(`Binary files are not readable: ${target.relative}`);
    }
    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    const startLine = clampLine(options.startLine, 1, lines.length || 1);
    const requestedEnd = options.endLine ?? startLine + MAX_FILE_LINES - 1;
    const endLine = clampLine(requestedEnd, startLine, Math.min(lines.length || 1, startLine + MAX_FILE_LINES - 1));
    return {
      projectId: project.id,
      path: target.relative,
      content: lines.slice(startLine - 1, endLine).join("\n"),
      size: info.size,
      totalLines: lines.length,
      startLine,
      endLine,
      truncated: startLine > 1 || endLine < lines.length,
    };
  }

  async searchFiles(
    project: HarnessProject,
    input: { query: string; path?: string; filePattern?: string },
  ): Promise<SearchResult> {
    const query = parseSearchText(input.query, "query", 200);
    const start = await resolveProjectPath(project, input.path ?? ".");
    const startStat = await stat(start.absolute);
    if (!startStat.isDirectory()) throw new InvalidHarnessInputError(`Search path is not a directory: ${start.relative}`);
    const pattern = input.filePattern ? createWildcardMatcher(input.filePattern) : undefined;
    const matches: SearchMatch[] = [];
    let scannedFiles = 0;
    let truncated = false;
    const pending: Array<{ absolute: string; relative: string; depth: number }> = [{
      absolute: start.absolute,
      relative: start.relative,
      depth: 0,
    }];
    const normalizedQuery = query.toLocaleLowerCase();

    while (pending.length > 0 && !truncated) {
      const current = pending.pop();
      if (!current) break;
      const entries = await readdir(current.absolute, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (current.depth < MAX_SEARCH_DEPTH && !IGNORED_DIRECTORIES.has(entry.name)) {
            const requestedChild = toProjectPath(join(current.relative, entry.name));
            try {
              const child = await resolveProjectPath(project, requestedChild);
              const childStat = await stat(child.absolute);
              if (childStat.isDirectory()) {
                pending.push({ absolute: child.absolute, relative: child.relative, depth: current.depth + 1 });
              }
            } catch (error) {
              if (!(error instanceof HarnessPathAccessError) && !(error instanceof HarnessFileNotFoundError)) throw error;
            }
          }
          continue;
        }
        if (!entry.isFile()) continue;
        const relativePath = toProjectPath(join(current.relative, entry.name));
        if (pattern && !pattern.test(relativePath)) continue;
        if (!isTextFile(entry.name)) continue;
        scannedFiles += 1;
        if (scannedFiles > MAX_SEARCH_FILES) {
          truncated = true;
          break;
        }
        const absolutePath = join(current.absolute, entry.name);
        const info = await stat(absolutePath);
        if (info.size > MAX_FILE_BYTES) continue;
        const buffer = await readFile(absolutePath);
        if (buffer.includes(0)) continue;
        const lines = buffer.toString("utf8").split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          if (!lines[index].toLocaleLowerCase().includes(normalizedQuery)) continue;
          matches.push({
            path: relativePath,
            line: index + 1,
            preview: lines[index].trim().slice(0, 240),
          });
          if (matches.length >= MAX_SEARCH_RESULTS) {
            truncated = true;
            break;
          }
        }
        if (truncated) break;
      }
    }

    return { projectId: project.id, query, matches, scannedFiles, truncated };
  }
}

async function resolveProjectPath(
  project: HarnessProject,
  requestedPath: string,
): Promise<{ absolute: string; relative: string }> {
  if (typeof requestedPath !== "string" || requestedPath.length > 2_048 || requestedPath.includes("\0")) {
    throw new InvalidHarnessInputError("Path must be a valid string up to 2048 characters");
  }
  const normalizedInput = requestedPath.trim() || ".";
  if (isAbsolute(normalizedInput)) {
    throw new HarnessPathAccessError("Absolute paths are not allowed inside a project");
  }
  const root = await realpath(project.path);
  const candidate = resolve(root, normalizedInput);
  let target: string;
  try {
    target = await realpath(candidate);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new HarnessFileNotFoundError(`Path not found: ${normalizedInput}`);
    }
    if (isNodeError(error, "EACCES") || isNodeError(error, "EPERM")) {
      throw new HarnessPathAccessError(`Path is not accessible: ${normalizedInput}`);
    }
    throw error;
  }
  const relativePath = relative(root, target);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new HarnessPathAccessError("Path escapes the selected project root");
  }
  return { absolute: target, relative: toProjectPath(relativePath || ".") };
}

function toProjectPath(value: string): string {
  return value === "" ? "." : value.split(sep).join("/");
}

function clampLine(value: number | undefined, minimum: number, maximum: number): number {
  const number = value ?? minimum;
  if (!Number.isInteger(number) || number < minimum) {
    throw new InvalidHarnessInputError(`Line number must be an integer >= ${minimum}`);
  }
  return Math.min(number, maximum);
}

function parseSearchText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length < 2 || value.trim().length > maxLength) {
    throw new InvalidHarnessInputError(`${field} must contain 2-${maxLength} characters`);
  }
  return value.trim();
}

function createWildcardMatcher(value: string): RegExp {
  const pattern = parseSearchText(value, "filePattern", 100);
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function isTextFile(name: string): boolean {
  const lastDot = name.lastIndexOf(".");
  if (lastDot < 0) return ["Dockerfile", "Makefile", "LICENSE"].includes(name);
  return TEXT_EXTENSIONS.has(name.slice(lastDot).toLocaleLowerCase());
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
