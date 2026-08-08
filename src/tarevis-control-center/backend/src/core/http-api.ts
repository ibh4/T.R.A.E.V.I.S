import type { IncomingMessage, ServerResponse } from "node:http";
import { routeDevicesRequest } from "../modules/devices/devices-routes.js";
import { routeEventsRequest } from "../modules/events/events-routes.js";
import { routeCommandsRequest } from "../modules/commands/commands-routes.js";
import { routeTraeRequest } from "../modules/trae/trae-routes.js";
import { routeRobotRequest } from "../modules/robot/robot-routes.js";
import { routeHarnessRequest } from "../modules/harness/harness-routes.js";
import type { CompositionRoot } from "./composition-root.js";
import { errorEnvelope } from "./contracts.js";

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

export function createHttpHandler(root: CompositionRoot) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (request.method === "GET" && pathname === "/api/health") {
        sendJson(response, 200, {
          ok: true,
          mode: root.config.mode,
          revision: root.realtimeHub.getRevision(),
          modules: root.getModuleHealth(),
        });
        return;
      }
      if (request.method === "GET" && pathname === "/api/state") {
        sendJson(response, 200, root.realtimeHub.getEnvelope());
        return;
      }
      if (request.method === "POST" && pathname === "/api/demo/reset") {
        sendJson(response, 200, await root.resetDemo());
        return;
      }

      const harnessResult = await routeHarnessRequest(request, pathname, root.harness);
      if (harnessResult) {
        sendJson(response, harnessResult.status, harnessResult.body);
        return;
      }

      const devicesResult = await routeDevicesRequest(request, pathname, root.devices);
      if (devicesResult) {
        sendJson(response, devicesResult.status, devicesResult.body);
        return;
      }

      const eventsResult = await routeEventsRequest(request, pathname, root.events);
      if (eventsResult) {
        sendJson(response, eventsResult.status, eventsResult.body);
        return;
      }

      const traeResult = await routeTraeRequest(request, pathname, root.trae);
      if (traeResult) {
        sendJson(response, traeResult.status, traeResult.body);
        return;
      }

      const robotResult = await routeRobotRequest(request, pathname, root.robot);
      if (robotResult) {
        sendJson(response, robotResult.status, robotResult.body);
        return;
      }

      const commandsResult = routeCommandsRequest(request, pathname, root.commands);
      if (commandsResult) {
        sendJson(response, commandsResult.status, commandsResult.body);
        return;
      }

      sendJson(response, 404, errorEnvelope("NOT_FOUND", `No route for ${request.method ?? "UNKNOWN"} ${pathname}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      root.logger.error("http.request_failed", {
        method: request.method ?? "UNKNOWN",
        path: request.url ?? "/",
        error: message,
      });
      sendJson(response, 500, errorEnvelope("INTERNAL_ERROR", "Internal server error"));
    }
  };
}
