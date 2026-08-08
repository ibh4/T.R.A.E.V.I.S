import type { IncomingMessage } from "node:http";
import { errorEnvelope } from "../../core/contracts.js";
import {
  EventNotFoundError,
  InvalidEventTransitionError,
  type EventsService,
} from "./events-service.js";
import { InvalidEventInputError } from "./events-types.js";

const MAX_BODY_BYTES = 65_536;

export interface EventsHttpRouteResult {
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
      throw new InvalidEventInputError("Event body exceeds 65536 bytes");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new InvalidEventInputError("Event body must contain valid JSON");
  }
}

export async function routeEventsRequest(
  request: IncomingMessage,
  pathname: string,
  events: EventsService | undefined,
): Promise<EventsHttpRouteResult | undefined> {
  const isReport = request.method === "POST" && pathname === "/api/events";
  const actionMatch = request.method === "POST"
    ? /^\/api\/events\/([^/]+)\/(ack|resolve)$/.exec(pathname)
    : null;
  if (!isReport && !actionMatch) return undefined;

  if (!events) {
    return {
      status: 503,
      body: errorEnvelope(
        "MODULE_UNAVAILABLE",
        "EventsModule has no live adapter and is unavailable in live mode",
      ),
    };
  }

  try {
    const body = await readJsonBody(request);
    if (isReport) {
      const result = events.report(body);
      return {
        status: result.created ? 201 : 200,
        body: { event: result.event, created: result.created },
      };
    }

    const eventId = decodeURIComponent(actionMatch?.[1] ?? "");
    const action = actionMatch?.[2];
    const event = action === "ack"
      ? events.acknowledge(eventId, body)
      : events.resolve(eventId, body);
    return { status: 200, body: { event } };
  } catch (error) {
    if (error instanceof InvalidEventInputError || error instanceof URIError) {
      return { status: 400, body: errorEnvelope("INVALID_INPUT", error.message) };
    }
    if (error instanceof EventNotFoundError) {
      return { status: 404, body: errorEnvelope("EVENT_NOT_FOUND", error.message) };
    }
    if (error instanceof InvalidEventTransitionError) {
      return { status: 409, body: errorEnvelope("INVALID_STATE_TRANSITION", error.message) };
    }
    throw error;
  }
}
