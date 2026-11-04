// How long a task keeps retrying after it starts failing. Only a provider's Retry-After can pass it.
export const TASK_RETRY_WINDOW_MS = 60 * 60_000;

// A longer wait is treated as a bad header rather than something a task should sit through.
const MAX_RETRY_AFTER_MS = 24 * 60 * 60_000;

function acceptRetryAfterMs(value: number): number | null {
  return Number.isFinite(value) && value >= 0 && value <= MAX_RETRY_AFTER_MS ? value : null;
}

// Retry-After is either a number of seconds or an HTTP date.
export function parseRetryAfterHeaderMs(value: string | null | undefined, nowMs = Date.now()): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) return acceptRetryAfterMs(Number(text) * 1000);
  return acceptRetryAfterMs(Date.parse(text) - nowMs);
}

function readHeader(headers: unknown): string | null {
  if (headers instanceof Headers) return headers.get("retry-after");
  if (!headers || typeof headers !== "object") return null;
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === "retry-after" && typeof value === "string") return value;
  }
  return null;
}

// Reads the wait from a provider error, or from one that already carries it across the Run API.
export function readRetryAfterMs(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const { retryAfterMs, headers } = error as { retryAfterMs?: unknown; headers?: unknown };
  if (typeof retryAfterMs === "number") return acceptRetryAfterMs(retryAfterMs);
  return parseRetryAfterHeaderMs(readHeader(headers));
}

export function parseRetryDeadlineMs(deadline: string | undefined): number | null {
  const deadlineMs = deadline ? Date.parse(deadline) : Number.NaN;
  return Number.isFinite(deadlineMs) ? deadlineMs : null;
}
