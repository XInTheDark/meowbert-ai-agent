import type { ModelUsageCounts } from "@meowbert/shared";

export interface AcpConfigOptionChoice {
  value: string;
  name?: string;
}

export interface AcpConfigOption {
  id: string;
  currentValue?: string;
  options?: AcpConfigOptionChoice[];
}

export interface AcpPermissionOption {
  optionId: string;
  name?: string;
  kind?: string;
}

export interface AcpPermissionRequestParams {
  sessionId?: string;
  toolCall?: {
    toolCallId?: string;
    name?: string;
  };
  options?: AcpPermissionOption[];
}

export interface AcpUsagePayload {
  inputTokens?: unknown;
  outputTokens?: unknown;
  cachedReadTokens?: unknown;
  cachedWriteTokens?: unknown;
  thoughtTokens?: unknown;
  totalTokens?: unknown;
}

function readNonNegativeInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

// In agy acp 1.5.15, inputTokens excludes cached reads, while outputTokens already includes thoughtTokens.
// Meowbert's ModelUsageCounts expects inputTokens to include cache reads/writes and outputTokens to include reasoningTokens.
export function parseAgyUsageCounts(rawUsage: unknown): ModelUsageCounts | null {
  if (!rawUsage || typeof rawUsage !== "object") return null;
  const usage = rawUsage as AcpUsagePayload;
  if (typeof usage.inputTokens !== "number" && typeof usage.outputTokens !== "number") {
    return null;
  }
  const uncachedInput = readNonNegativeInt(usage.inputTokens);
  const cachedInputTokens = readNonNegativeInt(usage.cachedReadTokens);
  const cacheWriteInputTokens = readNonNegativeInt(usage.cachedWriteTokens);
  const outputTokens = readNonNegativeInt(usage.outputTokens);
  const reasoningTokens = readNonNegativeInt(usage.thoughtTokens);
  return {
    inputTokens: uncachedInput + cachedInputTokens + cacheWriteInputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    outputTokens,
    reasoningTokens
  };
}

export function matchConfigOptionValue(
  configOptions: unknown,
  configId: string,
  desiredValue: string
): string | null {
  if (!Array.isArray(configOptions)) return null;
  const option = configOptions.find(
    (entry): entry is AcpConfigOption => typeof entry === "object" && entry !== null && (entry as { id?: unknown }).id === configId
  );
  if (!option || !Array.isArray(option.options)) return null;
  const exact = option.options.find((choice) => choice.value === desiredValue);
  if (exact) return exact.value;
  const lower = desiredValue.toLowerCase();
  const caseInsensitive = option.options.find((choice) => choice.value.toLowerCase() === lower);
  return caseInsensitive?.value ?? null;
}

export function extractAgyTierMeta(result: Record<string, unknown>): { tierName: string | null; tierId: string | null } {
  const tier = (result._meta as { antigravity?: { tier?: { name?: unknown; id?: unknown } } } | undefined)?.antigravity?.tier;
  return {
    tierName: typeof tier?.name === "string" && tier.name.trim() ? tier.name.trim() : null,
    tierId: typeof tier?.id === "string" && tier.id.trim() ? tier.id.trim() : null
  };
}

export function decideAcpPermission(input: {
  params: AcpPermissionRequestParams;
  activeSessionId: string | null;
  allowedToolNames: ReadonlySet<string>;
  turnCancelled: boolean;
}): { response: Record<string, unknown>; allowed: boolean; shouldCancelTurn: boolean } {
  if (input.turnCancelled) {
    return { response: { outcome: { outcome: "cancelled" } }, allowed: false, shouldCancelTurn: false };
  }
  const options = Array.isArray(input.params.options) ? input.params.options : [];
  const toolName = typeof input.params.toolCall?.name === "string" ? input.params.toolCall.name : "";
  const sessionMatches = Boolean(input.activeSessionId && input.params.sessionId === input.activeSessionId);
  const isAllowedTool = sessionMatches && input.allowedToolNames.has(toolName);

  if (isAllowedTool) {
    const allowOption = options.find((opt) => opt.kind === "allow_once") ?? options.find((opt) => opt.kind === "allow_always");
    if (allowOption) {
      return {
        response: { outcome: { outcome: "selected", optionId: allowOption.optionId } },
        allowed: true,
        shouldCancelTurn: false
      };
    }
  }

  const rejectOption = options.find((opt) => opt.kind === "reject_once") ?? options.find((opt) => opt.kind === "reject_always");
  if (rejectOption) {
    return {
      response: { outcome: { outcome: "selected", optionId: rejectOption.optionId } },
      allowed: false,
      shouldCancelTurn: false
    };
  }
  return { response: { outcome: { outcome: "cancelled" } }, allowed: false, shouldCancelTurn: true };
}

export function buildAgyInitialPrompt(): string {
  return [
    "Call `meowbert_start` with `session_code: \"current\"` right now to load the Meowbert task instructions, conversation history, and available tools.",
    "Execute the task strictly through the `meowbert-bridge` MCP tools (never local tools).",
    "Finish by calling `meowbert_final_response` (or `meowbert_wait` / `meowbert_stop_task` if appropriate)."
  ].join("\n");
}

export function buildAgyContinuationNudgePrompt(): string {
  return [
    "The Meowbert bridge session is still open because no final response was submitted.",
    "Continue using the `meowbert-bridge` MCP tools and finish by calling `meowbert_final_response` (or `meowbert_wait` / `meowbert_stop_task`)."
  ].join("\n");
}
