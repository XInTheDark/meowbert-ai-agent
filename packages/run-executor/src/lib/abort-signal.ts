const DEFAULT_ABORT_MESSAGE = "TASK_CANCELLED";
const GENERIC_ABORT_MESSAGES = new Set([
  "",
  "aborterror: this operation was aborted",
  "this operation was aborted"
]);

function normalizeAbortReason(reason: unknown): Error {
  if (reason instanceof Error) {
    const normalized = `${reason.name}: ${reason.message}`.trim().toLowerCase();
    if (GENERIC_ABORT_MESSAGES.has(normalized) || GENERIC_ABORT_MESSAGES.has(reason.message.trim().toLowerCase())) {
      return new Error(DEFAULT_ABORT_MESSAGE);
    }

    const trimmedMessage = reason.message.trim();
    return new Error(trimmedMessage.length > 0 ? trimmedMessage : DEFAULT_ABORT_MESSAGE);
  }

  if (typeof reason === "string") {
    const trimmed = reason.trim();
    return new Error(trimmed.length > 0 ? trimmed : DEFAULT_ABORT_MESSAGE);
  }

  return new Error(DEFAULT_ABORT_MESSAGE);
}

export function getAbortError(signal: AbortSignal | undefined): Error | null {
  if (!signal?.aborted) {
    return null;
  }

  return normalizeAbortReason(signal.reason);
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  const abortError = getAbortError(signal);
  if (abortError) {
    throw abortError;
  }
}
