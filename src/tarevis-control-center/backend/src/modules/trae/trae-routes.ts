import type { IncomingMessage } from "node:http";
import { errorEnvelope } from "../../core/contracts.js";
import type { TraeService } from "./trae-service.js";
import {
  TraeCommandConflictError,
  TraeModuleUnavailableError,
} from "./trae-service.js";
import { InvalidTraeCommandInputError } from "./trae-types.js";

const MAX_BODY_BYTES = 16_384;

export interface TraeHttpRouteResult {
  status: number;
  body: unknown;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new InvalidTraeCommandInputError("TRAE command body exceeds 16384 bytes");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new InvalidTraeCommandInputError("TRAE command body must contain valid JSON");
  }
}

export async function routeTraeRequest(
  request: IncomingMessage,
  pathname: string,
  trae: TraeService | undefined,
): Promise<TraeHttpRouteResult | undefined> {
  if (request.method !== "POST" || pathname !== "/api/trae/commands") return undefined;
  if (!trae) {
    return {
      status: 503,
      body: errorEnvelope(
        "MODULE_UNAVAILABLE",
        "TraeModule has no live adapter and is unavailable in live mode",
      ),
    };
  }

  try {
    const result = trae.submit(await readJsonBody(request));
    return {
      status: result.created ? 202 : 200,
      body: { command: result.command, created: result.created },
    };
  } catch (error) {
    if (error instanceof InvalidTraeCommandInputError) {
      return { status: 400, body: errorEnvelope("INVALID_INPUT", error.message) };
    }
    if (error instanceof TraeCommandConflictError) {
      return { status: 409, body: errorEnvelope("REQUEST_ID_CONFLICT", error.message) };
    }
    if (error instanceof TraeModuleUnavailableError) {
      return { status: 503, body: errorEnvelope("MODULE_UNAVAILABLE", error.message) };
    }
    throw error;
  }
}
