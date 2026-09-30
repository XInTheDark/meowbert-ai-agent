const TOOL_EVENT_INPUT_MAX_CHARS = 2_000;

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function rethrowIfTaskCancelled(error: unknown): void {
  if (error instanceof Error && error.message === "TASK_CANCELLED") {
    throw error;
  }
}

export function normalizeToolEventText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.length <= TOOL_EVENT_INPUT_MAX_CHARS) {
    return trimmed;
  }

  return `${trimmed.slice(0, TOOL_EVENT_INPUT_MAX_CHARS - 1)}…`;
}

export function summarizeToolEventValue(value: unknown): string | null {
  try {
    return normalizeToolEventText(JSON.stringify(value, null, 2));
  } catch {
    return null;
  }
}
