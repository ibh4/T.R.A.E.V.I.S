import type { IncomingMessage } from "node:http";
import { errorEnvelope } from "../../core/contracts.js";
import type { RobotService } from "./robot-service.js";
import { RobotCommandConflictError } from "./robot-service.js";
import { InvalidRobotCommandInputError } from "./robot-types.js";

const MAX_BODY_BYTES = 16_384;

export interface RobotHttpRouteResult {
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
      throw new InvalidRobotCommandInputError("Robot command body exceeds 16384 bytes");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new InvalidRobotCommandInputError("Robot command body must contain valid JSON");
  }
}

export async function routeRobotRequest(
  request: IncomingMessage,
  pathname: string,
  robot: RobotService | undefined,
): Promise<RobotHttpRouteResult | undefined> {
  const isCommand = request.method === "POST" && pathname === "/api/robot/commands";
  const isEmergencyStop = request.method === "POST" && pathname === "/api/robot/emergency-stop";
  if (!isCommand && !isEmergencyStop) return undefined;
  if (!robot) {
    return {
      status: 503,
      body: errorEnvelope(
        "MODULE_UNAVAILABLE",
        "RobotModule has no live adapter and is unavailable in live mode",
      ),
    };
  }

  try {
    const body = await readJsonBody(request);
    const result = isEmergencyStop ? robot.emergencyStop(body) : robot.submit(body);
    return {
      status: result.created ? 202 : 200,
      body: { command: result.command, created: result.created },
    };
  } catch (error) {
    if (error instanceof InvalidRobotCommandInputError) {
      return { status: 400, body: errorEnvelope("INVALID_INPUT", error.message) };
    }
    if (error instanceof RobotCommandConflictError) {
      return { status: 409, body: errorEnvelope("REQUEST_ID_CONFLICT", error.message) };
    }
    throw error;
  }
}
