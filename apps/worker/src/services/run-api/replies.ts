import { readRetryAfterMs, type RunApiErrorBody } from "@meowbert/shared";
import { RunApiFailure } from "./failure.js";
import type { StoredOperationResponse } from "./stores.js";

function retryAfterFields(error: unknown): { retryAfterMs?: number } {
  const retryAfterMs = readRetryAfterMs(error);
  return retryAfterMs !== null ? { retryAfterMs } : {};
}

export interface RunApiReply {
  status: number;
  body: unknown;
}

export function errorReply(error: unknown): RunApiReply {
  if (error instanceof RunApiFailure) {
    const body: RunApiErrorBody = { error: { code: error.code, message: error.message, ...(error.currentLeafId !== null ? { currentLeafId: error.currentLeafId } : {}), ...retryAfterFields(error) } };
    return { status: error.status, body };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: 500, body: { error: { code: "internal", message, ...retryAfterFields(error) } } satisfies RunApiErrorBody };
}

export function storedReply(response: StoredOperationResponse): RunApiReply {
  return response.ok
    ? { status: 200, body: { result: response.result } }
    : { status: response.status, body: { error: response.error } };
}
