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
