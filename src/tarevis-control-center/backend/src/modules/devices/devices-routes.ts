import type { IncomingMessage } from "node:http";
import { errorEnvelope } from "../../core/contracts.js";
import {
  DeviceNotFoundError,
  type DevicesService,
} from "./devices-service.js";
import {
  InvalidDeviceHeartbeatError,
  parseDeviceHeartbeatInput,
} from "./devices-types.js";

const MAX_BODY_BYTES = 16_384;

export interface HttpRouteResult {
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
      throw new InvalidDeviceHeartbeatError("Heartbeat body exceeds 16384 bytes");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new InvalidDeviceHeartbeatError("Heartbeat body must contain valid JSON");
  }
}

export async function routeDevicesRequest(
  request: IncomingMessage,
  pathname: string,
  devices: DevicesService | undefined,
): Promise<HttpRouteResult | undefined> {
  const match = /^\/api\/devices\/([^/]+)\/heartbeat$/.exec(pathname);
  if (request.method !== "POST" || !match) return undefined;

  if (!devices) {
    return {
      status: 503,
      body: errorEnvelope(
        "MODULE_UNAVAILABLE",
        "DevicesModule has no live adapter and is unavailable in live mode",
      ),
    };
  }

  try {
    const deviceId = decodeURIComponent(match[1] ?? "");
    const input = parseDeviceHeartbeatInput(await readJsonBody(request));
    return {
      status: 200,
      body: { device: devices.heartbeat(deviceId, input) },
    };
  } catch (error) {
    if (error instanceof InvalidDeviceHeartbeatError || error instanceof URIError) {
      return {
        status: 400,
        body: errorEnvelope("INVALID_INPUT", error.message),
      };
    }
    if (error instanceof DeviceNotFoundError) {
      return {
        status: 404,
        body: errorEnvelope("DEVICE_NOT_FOUND", error.message),
      };
    }
    throw error;
  }
}
