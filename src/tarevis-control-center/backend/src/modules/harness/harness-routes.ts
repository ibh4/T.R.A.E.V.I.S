import type { IncomingMessage } from "node:http";
import { errorEnvelope } from "../../core/contracts.js";
import type { HarnessService } from "./harness-service.js";
import {
  HarnessFileNotFoundError,
  HarnessModelNotConfiguredError,
  HarnessModelRequestError,
  HarnessPathAccessError,
  HarnessProjectNotFoundError,
  InvalidHarnessInputError,
} from "./harness-types.js";

const MAX_BODY_BYTES = 65_536;

export interface HarnessHttpRouteResult {
  status: number;
  body: unknown;
}

export async function routeHarnessRequest(
  request: IncomingMessage,
  pathname: string,
  harness: HarnessService,
): Promise<HarnessHttpRouteResult | undefined> {
  if (!pathname.startsWith("/api/harness")) return undefined;

  try {
    if (request.method === "GET" && pathname === "/api/harness/status") {
      return { status: 200, body: await harness.getStatus() };
    }
    if (pathname === "/api/harness/projects") {
      if (request.method === "GET") {
        return { status: 200, body: { projects: await harness.registry.list() } };
      }
      if (request.method === "POST") {
        return { status: 201, body: { project: await harness.registry.create(await readJsonBody(request)) } };
      }
    }
    if (request.method === "POST" && pathname === "/api/harness/chat") {
      return { status: 200, body: await harness.chat(await readJsonBody(request)) };
    }

    const projectMatch = /^\/api\/harness\/projects\/([^/]+)(?:\/(tree|file))?$/.exec(pathname);
    if (!projectMatch) return undefined;
    const projectId = decodeURIComponent(projectMatch[1]);
    const action = projectMatch[2];

    if (!action && request.method === "PATCH") {
      return {
        status: 200,
        body: { project: await harness.registry.update(projectId, await readJsonBody(request)) },
      };
    }
    if (!action && request.method === "DELETE") {
      return { status: 200, body: { project: await harness.registry.remove(projectId) } };
    }
    if (action === "tree" && request.method === "GET") {
      const project = await harness.registry.get(projectId);
      const url = new URL(request.url ?? pathname, "http://localhost");
      return {
        status: 200,
        body: await harness.tools.listDirectory(project, url.searchParams.get("path") ?? "."),
      };
    }
    if (action === "file" && request.method === "GET") {
      const project = await harness.registry.get(projectId);
      const url = new URL(request.url ?? pathname, "http://localhost");
      const path = url.searchParams.get("path");
      if (!path) throw new InvalidHarnessInputError("File path is required");
      return {
        status: 200,
        body: await harness.tools.readFile(project, path, {
          startLine: parseOptionalLine(url.searchParams.get("startLine"), "startLine"),
          endLine: parseOptionalLine(url.searchParams.get("endLine"), "endLine"),
        }),
      };
    }
    return undefined;
  } catch (error) {
    if (error instanceof InvalidHarnessInputError || error instanceof URIError) {
      return { status: 400, body: errorEnvelope("INVALID_INPUT", error.message) };
    }
    if (error instanceof HarnessProjectNotFoundError || error instanceof HarnessFileNotFoundError) {
      return { status: 404, body: errorEnvelope("NOT_FOUND", error.message) };
    }
    if (error instanceof HarnessPathAccessError) {
      return { status: 403, body: errorEnvelope("PATH_OUTSIDE_PROJECT", error.message) };
    }
    if (error instanceof HarnessModelNotConfiguredError) {
      return { status: 503, body: errorEnvelope("MODEL_NOT_CONFIGURED", error.message) };
    }
    if (error instanceof HarnessModelRequestError) {
      return { status: 502, body: errorEnvelope("MODEL_REQUEST_FAILED", error.message) };
    }
    throw error;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new InvalidHarnessInputError(`Request body exceeds ${MAX_BODY_BYTES} bytes`);
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new InvalidHarnessInputError("Request body must contain valid JSON");
  }
}

function parseOptionalLine(value: string | null, field: string): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidHarnessInputError(`${field} must be a positive integer`);
  }
  return parsed;
}
