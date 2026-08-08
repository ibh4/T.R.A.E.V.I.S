import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { HarnessProject } from "./harness-types.js";
import {
  HarnessProjectNotFoundError,
  InvalidHarnessInputError,
} from "./harness-types.js";

interface RegistryDocument {
  version: 1;
  projects: HarnessProject[];
}

export interface ProjectRegistryOptions {
  filePath: string;
  defaultProjectPath: string;
  now?: () => Date;
  createId?: () => string;
}

export class ProjectRegistry {
  private projects: HarnessProject[] = [];
  private loading: Promise<void> | undefined;
  private mutationQueue: Promise<void> = Promise.resolve();
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(private readonly options: ProjectRegistryOptions) {
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
  }

  async list(): Promise<HarnessProject[]> {
    await this.ensureLoaded();
    return this.projects.map((project) => ({ ...project }));
  }

  async get(projectId: string): Promise<HarnessProject> {
    await this.ensureLoaded();
    const project = this.projects.find((item) => item.id === projectId);
    if (!project) throw new HarnessProjectNotFoundError(`Project not found: ${projectId}`);
    return { ...project };
  }

  create(input: unknown): Promise<HarnessProject> {
    return this.mutate(async () => {
      const record = parseProjectInput(input, false);
      if (record.name === undefined || record.path === undefined) {
        throw new InvalidHarnessInputError("Project name and path are required");
      }
      const projectPath = await validateDirectory(record.path);
      const now = this.now().toISOString();
      const project: HarnessProject = {
        id: this.createId(),
        name: record.name,
        path: projectPath,
        createdAt: now,
        updatedAt: now,
      };
      this.projects.push(project);
      await this.persist();
      return { ...project };
    });
  }

  update(projectId: string, input: unknown): Promise<HarnessProject> {
    return this.mutate(async () => {
      const index = this.projects.findIndex((project) => project.id === projectId);
      if (index < 0) throw new HarnessProjectNotFoundError(`Project not found: ${projectId}`);
      const record = parseProjectInput(input, true);
      if (record.name === undefined && record.path === undefined) {
        throw new InvalidHarnessInputError("At least one of name or path is required");
      }
      const current = this.projects[index];
      const updated: HarnessProject = {
        ...current,
        name: record.name ?? current.name,
        path: record.path === undefined ? current.path : await validateDirectory(record.path),
        updatedAt: this.now().toISOString(),
      };
      this.projects[index] = updated;
      await this.persist();
      return { ...updated };
    });
  }

  remove(projectId: string): Promise<HarnessProject> {
    return this.mutate(async () => {
      const index = this.projects.findIndex((project) => project.id === projectId);
      if (index < 0) throw new HarnessProjectNotFoundError(`Project not found: ${projectId}`);
      const [removed] = this.projects.splice(index, 1);
      await this.persist();
      return { ...removed };
    });
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    try {
      const raw = await readFile(this.options.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      this.projects = parseRegistryDocument(parsed).projects;
    } catch (error) {
      if (!isNodeError(error, "ENOENT")) throw error;
      const defaultPath = await validateDirectory(this.options.defaultProjectPath);
      const now = this.now().toISOString();
      this.projects = [{
        id: "tarevis-control-center",
        name: "TRAEVIS Competition",
        path: defaultPath,
        createdAt: now,
        updatedAt: now,
      }];
      await this.persist();
    }
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(async () => {
      await this.ensureLoaded();
      return operation();
    });
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.options.filePath), { recursive: true });
    const temporaryPath = `${this.options.filePath}.${process.pid}.tmp`;
    const document: RegistryDocument = { version: 1, projects: this.projects };
    await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporaryPath, this.options.filePath);
  }
}

async function validateDirectory(value: string): Promise<string> {
  const absolutePath = resolve(value);
  let info;
  try {
    info = await stat(absolutePath);
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      throw new InvalidHarnessInputError(`Project path does not exist: ${absolutePath}`);
    }
    throw error;
  }
  if (!info.isDirectory()) {
    throw new InvalidHarnessInputError(`Project path is not a directory: ${absolutePath}`);
  }
  return realpath(absolutePath);
}

function parseProjectInput(
  input: unknown,
  partial: boolean,
): { name?: string; path?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidHarnessInputError("Project body must be an object");
  }
  const record = input as Record<string, unknown>;
  const name = parseOptionalText(record.name, "name", 80);
  const path = parseOptionalText(record.path, "path", 1_024);
  if (!partial && (name === undefined || path === undefined)) {
    throw new InvalidHarnessInputError("Project name and path are required");
  }
  return { name, path };
}

function parseOptionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new InvalidHarnessInputError(`${field} must be a non-empty string up to ${maxLength} characters`);
  }
  return value.trim();
}

function parseRegistryDocument(input: unknown): RegistryDocument {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InvalidHarnessInputError("Project registry must be an object");
  }
  const record = input as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.projects)) {
    throw new InvalidHarnessInputError("Unsupported project registry format");
  }
  const projects = record.projects.map((project, index) => {
    if (!project || typeof project !== "object" || Array.isArray(project)) {
      throw new InvalidHarnessInputError(`Invalid project at index ${index}`);
    }
    const value = project as Record<string, unknown>;
    for (const field of ["id", "name", "path", "createdAt", "updatedAt"] as const) {
      if (typeof value[field] !== "string" || !value[field]) {
        throw new InvalidHarnessInputError(`Invalid ${field} at project index ${index}`);
      }
    }
    return value as unknown as HarnessProject;
  });
  if (new Set(projects.map((project) => project.id)).size !== projects.length) {
    throw new InvalidHarnessInputError("Project ids must be unique");
  }
  return { version: 1, projects };
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
