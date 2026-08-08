import type { IncomingMessage } from "node:http";
import { errorEnvelope } from "../../core/contracts.js";
import type { CommandsService } from "./commands-service.js";
import { COMMAND_TARGETS, type CommandTarget } from "./commands-types.js";

export interface CommandsHttpRouteResult {
  status: number;
  body: unknown;
}

export function routeCommandsRequest(
  request: IncomingMessage,
  pathname: string,
  commands: CommandsService,
): CommandsHttpRouteResult | undefined {
  if (request.method !== "GET" || pathname !== "/api/commands") return undefined;
  const target = new URL(request.url ?? pathname, "http://localhost").searchParams.get("target");
  if (!target || !COMMAND_TARGETS.includes(target as CommandTarget)) {
    return {
      status: 400,
      body: errorEnvelope(
        "INVALID_INPUT",
        `target must be one of: ${COMMAND_TARGETS.join(", ")}`,
      ),
    };
  }
  return { status: 200, body: { commands: commands.list(target as CommandTarget) } };
}
