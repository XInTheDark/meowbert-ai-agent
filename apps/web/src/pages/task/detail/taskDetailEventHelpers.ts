import type { LiveEvent } from "../../../lib/types";
import { hashText } from "./taskDetailUtils";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseIncomingTaskEvent(raw: unknown, fallbackType?: string): LiveEvent | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as {
    id?: unknown;
    type?: unknown;
    payload?: unknown;
    createdAt?: unknown;
  };
  const type = typeof candidate.type === "string" ? candidate.type : fallbackType;
  if (!type) {
    return null;
  }

  const payload =
    candidate.payload && typeof candidate.payload === "object"
      ? (candidate.payload as Record<string, unknown>)
      : {};
  const createdAt = typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString();
  const id =
    typeof candidate.id === "string"
      ? candidate.id
      : `${createdAt}:${type}:${hashText(JSON.stringify(payload))}`;

  return {
    id,
    type,
    createdAt,
    payload
  };
}

export function serializeTaskEventsForClipboard(events: LiveEvent[]): string {
  return JSON.stringify(
    events.map((event) => ({
      id: event.id,
      type: event.type,
      createdAt: event.createdAt,
      payload: event.payload
    })),
    null,
    2
  );
}

export function getNetworkRequestReplayText(event: LiveEvent): string | null {
  const networkRequest = isRecord(event.payload.networkRequest) ? event.payload.networkRequest : null;
  const request = networkRequest && isRecord(networkRequest.request) ? networkRequest.request : null;
  if (!request) {
    return null;
  }

  const curl = typeof request.curl === "string" ? request.curl : null;
  if (curl && curl.trim().length > 0) {
    return curl;
  }

  return JSON.stringify(request, null, 2);
}
