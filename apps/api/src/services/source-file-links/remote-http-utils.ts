import { setTimeout as delay } from "node:timers/promises";

export interface RemoteFetchResult {
  response: Response;
  payload: unknown;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function parseResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }

  const text = await response.text().catch(() => "");
  return text ? { error: text } : null;
}

export function readSourceErrorMessage(payload: unknown, status: number): string {
  if (isPlainObject(payload)) {
    const topMessage = typeof payload.error_description === "string"
      ? payload.error_description
      : typeof payload.error === "string"
        ? payload.error
        : null;
    const nestedError = payload.error;
    const nestedMessage = isPlainObject(nestedError)
      && typeof nestedError.message === "string"
      && nestedError.message.trim().length > 0
      ? nestedError.message
      : null;

    return nestedMessage ?? topMessage ?? `HTTP ${status}`;
  }

  return `HTTP ${status}`;
}

function parseRetryDelayMilliseconds(response: Response, attempt: number, baseDelayMs: number): number {
  const retryAfterValue = response.headers.get("retry-after");
  if (retryAfterValue) {
    const retryAfterSeconds = Number.parseInt(retryAfterValue, 10);
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
      return retryAfterSeconds * 1_000;
    }

    const retryAfterDate = Date.parse(retryAfterValue);
    if (Number.isFinite(retryAfterDate)) {
      return Math.max(retryAfterDate - Date.now(), 0);
    }
  }

  return baseDelayMs * (2 ** attempt);
}

export async function fetchRemoteWithRetry(input: {
  execute: () => Promise<Response>;
  retryableStatusCodes: ReadonlySet<number>;
  baseDelayMs: number;
  maxAttempts: number;
  unexpectedExitMessage: string;
}): Promise<RemoteFetchResult> {
  for (let attempt = 0; attempt < input.maxAttempts; attempt += 1) {
    const response = await input.execute();
    const payload = await parseResponsePayload(response);

    if (!input.retryableStatusCodes.has(response.status) || attempt === input.maxAttempts - 1) {
      return { response, payload };
    }

    await delay(parseRetryDelayMilliseconds(response, attempt, input.baseDelayMs));
  }

  throw new Error(input.unexpectedExitMessage);
}
