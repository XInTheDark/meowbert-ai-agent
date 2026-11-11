const CONTEXT_WINDOW_ERROR_PATTERNS = [
  /context_length_exceeded/i,
  /input exceeds the context window/i,
  /exceeds the context window/i,
  /maximum context length/i,
  /max context length/i,
  /context window/i,
  /too many tokens/i,
  /input is too long/i
];

function collectErrorText(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  if (typeof value !== "object" || seen.has(value)) {
    return [];
  }
  seen.add(value);

  if (value instanceof Error) {
    return [
      value.name,
      value.message,
      ...collectErrorText((value as Error & { code?: unknown }).code, seen),
      ...collectErrorText((value as Error & { type?: unknown }).type, seen),
      ...collectErrorText((value as Error & { status?: unknown }).status, seen),
      ...collectErrorText((value as Error & { error?: unknown }).error, seen)
    ];
  }

  const record = value as Record<string, unknown>;
  return [
    record.message,
    record.code,
    record.type,
    record.status,
    record.param,
    record.error
  ].flatMap((entry) => collectErrorText(entry, seen));
}

export function isContextWindowExceededError(error: unknown): boolean {
  const text = collectErrorText(error).join("\n");
  return CONTEXT_WINDOW_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export type ModelErrorAction = "compact_context";

export function resolveModelErrorAction(error: unknown): ModelErrorAction | null {
  if (isContextWindowExceededError(error)) {
    return "compact_context";
  }

  return null;
}

export function isModelSessionConflictError(error: unknown): boolean {
  return /this session advanced while the request was waiting/i.test(collectErrorText(error).join("\n"));
}

// Statuses a provider returns when it refuses the request body itself. Transport failures,
// overload, rate limits and auth errors never mean the history is at fault.
const REJECTED_REQUEST_STATUSES = new Set([400, 413, 415, 422]);

function isRejectedRequestError(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error && REJECTED_REQUEST_STATUSES.has(Number(error.status))) {
    return true;
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const status = /^\s*(\d{3})\b/.exec(message)?.[1];
  return status !== undefined && REJECTED_REQUEST_STATUSES.has(Number(status));
}

// The provider rejected something in the request history, so trimming it can let the run continue.
export function isRecoverableModelInputError(error: unknown): boolean {
  if (parseMissingToolOutput(error)) return true;
  if (isModelSessionConflictError(error) || isContextWindowExceededError(error)) return false;
  const text = collectErrorText(error).join("\n");
  return isRejectedRequestError(error)
    || /\b(?:invalid|malformed|corrupted?)\s+(?:image|base64|input|message|conversation|item)\b/i.test(text)
    || /\b(?:image|base64|input|message|conversation|item)(?:\s+data)?\s+is\s+(?:invalid|malformed|corrupted?)\b/i.test(text);
}

// Providers usually name the request item they rejected, as in "input[173].content[0]".
export function parseRejectedInputIndex(error: unknown): number | null {
  for (const text of collectErrorText(error)) {
    const match = /\binput\[(\d+)\]/.exec(text);
    if (match) return Number(match[1]);
  }
  return null;
}

export function isTerminalModelError(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return ["lease_lost", "outcome_unknown", "operation_conflict", "unauthorized", "quota_exceeded"].includes(String(error.code));
}

export type MissingToolOutputCallKind = "function_call" | "custom_tool_call" | "apply_patch_call";

export interface MissingToolOutputCall {
  callId: string;
  kind: MissingToolOutputCallKind;
}

const MISSING_TOOL_OUTPUT_PATTERNS = [
  /(?:no (?:tool|function) output found for|missing (?:tool|function) output for)\s+apply[_ ]?patch(?:[_ ]tool)?(?:[_ ]call)?[:\s]+['"`]?([a-zA-Z0-9_\-:]+)['"`]?/i,
  /(?:no (?:tool|function) output found for|missing (?:tool|function) output for)\s+(?:(function|custom)(?:\s+tool)?\s+)?(?:tool\s+)?call[:\s]+['"`]?([a-zA-Z0-9_\-:]+)['"`]?/i
];

export function parseMissingToolOutput(error: unknown): MissingToolOutputCall | null {
  const texts = collectErrorText(error);
  for (const text of texts) {
    const applyPatchMatch = text.match(MISSING_TOOL_OUTPUT_PATTERNS[0]);
    if (applyPatchMatch) {
      return { callId: applyPatchMatch[1], kind: "apply_patch_call" };
    }

    const match = text.match(MISSING_TOOL_OUTPUT_PATTERNS[1]);
    if (match) {
      return {
        callId: match[2],
        kind: match[1]?.toLowerCase() === "custom" ? "custom_tool_call" : "function_call"
      };
    }
  }

  return null;
}

export function parseMissingToolOutputCallId(error: unknown): string | null {
  return parseMissingToolOutput(error)?.callId ?? null;
}
