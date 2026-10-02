import type { ResponseInputItem, ResponseOutputItem } from "openai/resources/responses/responses";
import type { PlatformModelMetadata, PlatformUsageBilling } from "@meowbert/shared";
import { emitTaskEvent } from "../runtime/events.js";
import type { TaskMessageRow } from "../agent/types.js";
import type { OpenAiProviderConfig } from "../agent/openai-client.js";
import {
  estimateContextTokens,
  estimateTokensFromText,
  getMaxContextWindowTokens,
  isPlainObject,
  safeStringify,
  stringifyContextEstimateValue,
  truncate,
  truncateWithOptionalLimit
} from "./token-estimation.js";

export {
  estimateContextTokens,
  estimateTokensFromText,
  getMaxContextWindowTokens,
  isPlainObject,
  safeStringify,
  stringifyContextEstimateValue,
  truncate,
  truncateWithOptionalLimit
} from "./token-estimation.js";

export const AUTO_COMPACTION_THRESHOLD_RATIO = 0.85;
export const TARGET_POST_COMPACTION_RATIO = 0.55;
export const AUTO_COMPACTION_ERROR_COOLDOWN_MS = 10 * 60 * 1000;
export const COMPACTION_INPUT_MAX_UTILIZATION = 0.7;
export const MIN_LIVE_TAIL_ITEM_COUNT = 2;
export const MAX_LIVE_TAIL_ITEM_COUNT = 32;
export const MAX_SERIALIZED_ITEM_CHARS = 16_000;
export const COMPACTION_STATE_VERSION = 3;
export const COMPACTION_SUMMARY_MAX_ATTEMPTS = 4;
export const COMPACTION_SUMMARY_RETRY_BASE_DELAY_MS = 5000;
export const DEFAULT_COMPACTION_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
export const NATIVE_COMPACTION_RETAINED_MESSAGE_TOKEN_BUDGET = 50_000;

export const COMPACTION_MARKER_KIND = "context_compaction";
export const COMPACTION_TOOL_NAME = "store_compacted_context";
export const NATIVE_COMPACTION_PROVIDER_ERROR =
  "Native context compaction is only available when using the OpenAI Responses API provider.";
export const NATIVE_COMPACTION_PLACEHOLDER_MARKDOWN = [
  "## Native Context Compaction",
  "",
  "Stored an opaque model-readable compaction item via the Responses API compaction trigger.",
  "No human-readable summary is available for this backend."
].join("\n");

export const COMPACTION_SYSTEM_PROMPT = [
  "You are compacting conversation context for future model turns.",
  "Summarize faithfully and keep chronology/causality intact.",
  "Preserve user intent, constraints, decisions, technical details, errors, unresolved questions, and assumptions.",
  "Do not invent facts.",
  "Return dense, implementation-ready continuity notes in markdown.",
  "Prefer headings for goals/constraints, decisions/rationale, actions/results, tools/external data, risks/open items, and continuity notes."
].join(" ");

export const COMPACTION_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary_markdown: {
      type: "string",
      description:
        "High-density markdown summary with concrete details and explicit unknowns."
    },
    live_tail_start_index: {
      type: "integer",
      description:
        "1-based conversation item index where raw live-tail context should start. Choose the earliest item that should remain verbatim after the summary."
    }
  },
  required: ["summary_markdown", "live_tail_start_index"]
};

export interface CompactionStructuredOutput {
  summary_markdown: string;
  live_tail_start_index: number;
  [key: string]: unknown;
}

export interface CompactionHistoryPreparation {
  conversationHistory: string;
  estimatedInputTokens: number;
  estimatedInputUtilization: number;
  itemCharLimit: number;
  wasTruncated: boolean;
  includedItemCount: number;
  omittedItemCount: number;
  reductionReason: "none" | "context_window_exceeded";
  sourceStartIndex: number;
  sourceEndIndex: number;
}

export interface CompactionStateSegment {
  id: string;
  created_at: string;
  summary_markdown: string;
  model: string;
  trigger: CompactionTrigger;
  source_item_count: number;
  source_start_index: number;
  source_end_index: number;
  source_token_estimate: number;
  summary_token_estimate: number;
  serialization: {
    was_truncated: boolean;
    item_char_limit: number | null;
    estimated_input_tokens: number;
    estimated_input_utilization: number;
  };
}

export interface ConversationCompactionState {
  version: number;
  updated_at: string;
  segments: CompactionStateSegment[];
  source_item_count: number;
  source_token_estimate: number;
  summary_token_estimate: number;
}

export type CompactionBackendKind = "summary" | "native";
export type CompactionTrigger = "auto" | "manual" | "recovery";

export interface PreparedCompactionResult {
  backend: CompactionBackendKind;
  model: string;
  markerText: string;
  summaryMarkdown?: string;
  responseItems: ResponseInputItem[];
  nextItems: ResponseInputItem[];
  usageAfter: ContextUsageSnapshot;
  messageMetadata: Record<string, unknown>;
  completionMetadata: Record<string, unknown>;
}

export interface ContextUsageSnapshot {
  usedTokens: number;
  maxContextTokens: number;
  utilization: number;
  source: "estimate" | "actual";
  stage: "pre_model_call" | "post_compaction" | "post_model_response";
  step: number;
  cachedTokens?: number;
  cacheHitRatio?: number;
  prefixHash?: string;
  promptRevision?: string;
}

export interface CompactContextInput {
  provider: OpenAiProviderConfig;
  billing: PlatformUsageBilling | null;
  taskId: string;
  step: number;
  trigger: CompactionTrigger;
  model: string;
  compactionBackend?: CompactionBackendKind;
  requestTimeoutMs?: number;
  abortSignal?: AbortSignal;
  maxContextTokens: number;
  platformModelMetadata?: PlatformModelMetadata;
  systemPrompt: string;
  conversationItems: ResponseInputItem[];
  runPersistedItems: ResponseInputItem[];
  getCurrentLeafMessageId?: () => string | null;
  setCurrentLeafMessageId?: (messageId: string) => void;
}

export interface CompactContextResult {
  status: "skipped" | "compacted" | "error";
  reason?: string;
  usageBefore: ContextUsageSnapshot;
  usageAfter?: ContextUsageSnapshot;
  backend?: CompactionBackendKind;
  summaryMarkdown?: string;
}

export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const normalizedName = error.name.toLowerCase();
  const normalizedMessage = error.message.toLowerCase();
  return normalizedName.includes("abort") || normalizedMessage.includes("abort");
}

export function buildUsageSnapshot(input: {
  usedTokens: number;
  maxContextTokens: number;
  source: ContextUsageSnapshot["source"];
  stage: ContextUsageSnapshot["stage"];
  step: number;
  cachedTokens?: number;
  prefixHash?: string;
  promptRevision?: string;
}): ContextUsageSnapshot {
  const safeMax = Math.max(1, input.maxContextTokens);
  const utilization = Math.min(1, Math.max(0, input.usedTokens / safeMax));
  const normalizedCachedTokens =
    typeof input.cachedTokens === "number" && Number.isFinite(input.cachedTokens)
      ? Math.max(0, Math.floor(input.cachedTokens))
      : undefined;

  return {
    usedTokens: input.usedTokens,
    maxContextTokens: safeMax,
    utilization,
    source: input.source,
    stage: input.stage,
    step: input.step,
    ...(typeof normalizedCachedTokens === "number"
      ? {
          cachedTokens: normalizedCachedTokens,
          cacheHitRatio: Math.min(1, Math.max(0, normalizedCachedTokens / Math.max(1, input.usedTokens)))
        }
      : {}),
    ...(typeof input.prefixHash === "string" && input.prefixHash.length > 0 ? { prefixHash: input.prefixHash } : {}),
    ...(typeof input.promptRevision === "string" && input.promptRevision.length > 0
      ? { promptRevision: input.promptRevision }
      : {})
  };
}

export async function emitContextUsage(taskId: string, usage: ContextUsageSnapshot): Promise<void> {
  await emitTaskEvent(taskId, "context_usage", {
    usedTokens: usage.usedTokens,
    maxContextTokens: usage.maxContextTokens,
    utilization: usage.utilization,
    source: usage.source,
    stage: usage.stage,
    step: usage.step,
    ...(typeof usage.cachedTokens === "number" ? { cachedTokens: usage.cachedTokens } : {}),
    ...(typeof usage.cacheHitRatio === "number" ? { cacheHitRatio: usage.cacheHitRatio } : {}),
    ...(typeof usage.prefixHash === "string" ? { prefixHash: usage.prefixHash } : {}),
    ...(typeof usage.promptRevision === "string" ? { promptRevision: usage.promptRevision } : {})
  });
}

export function providerSupportsNativeCompaction(provider: OpenAiProviderConfig): boolean {
  if (provider.supportsNativeCompaction) {
    return true;
  }

  try {
    const hostname = new URL(provider.baseUrl).hostname.trim().toLowerCase();
    return (
      hostname === "api.openai.com" ||
      hostname.endsWith(".openai.com") ||
      hostname === "chatgpt.com" ||
      hostname.endsWith(".chatgpt.com")
    );
  } catch {
    return false;
  }
}

export function resolveCompactionRequestTimeoutMs(requestTimeoutMs: number | undefined): number {
  if (typeof requestTimeoutMs !== "number" || !Number.isFinite(requestTimeoutMs)) {
    return DEFAULT_COMPACTION_REQUEST_TIMEOUT_MS;
  }

  const floored = Math.floor(requestTimeoutMs);
  return floored > 0 ? floored : DEFAULT_COMPACTION_REQUEST_TIMEOUT_MS;
}

export function shouldKeepNativeCompactionOutputItem(item: ResponseOutputItem): boolean {
  if (item.type === "compaction") {
    return true;
  }

  if (item.type !== "message") {
    return false;
  }

  const role = (item as unknown as { role?: string }).role;
  return role === "user" || role === "system" || role === "developer";
}

function getNativeCompactionMessageRole(item: ResponseOutputItem): string | null {
  if (item.type !== "message") {
    return null;
  }

  const role = (item as unknown as { role?: unknown }).role;
  return typeof role === "string" ? role : null;
}

function truncateTextToTokenBudget(text: string, tokenBudget: number): string {
  if (estimateTokensFromText(text) <= tokenBudget) {
    return text;
  }

  return text.slice(0, Math.max(0, tokenBudget * 6));
}

function truncateRetainedUserMessage(
  item: ResponseOutputItem,
  tokenBudget: number
): ResponseInputItem | null {
  const record = item as unknown as { content?: unknown };
  if (typeof record.content === "string") {
    return {
      ...(item as unknown as Record<string, unknown>),
      content: truncateTextToTokenBudget(record.content, tokenBudget)
    } as ResponseInputItem;
  }

  if (!Array.isArray(record.content)) {
    return null;
  }

  let remainingTokens = tokenBudget;
  const content = record.content.flatMap((part) => {
    if (!isPlainObject(part) || typeof part.text !== "string") {
      return [];
    }

    const text = truncateTextToTokenBudget(part.text, remainingTokens);
    remainingTokens -= estimateTokensFromText(text);
    return [{ ...part, text }];
  });

  if (content.length === 0) {
    return null;
  }

  return {
    ...(item as unknown as Record<string, unknown>),
    content
  } as ResponseInputItem;
}

function limitRetainedNativeUserMessages(outputItems: ResponseOutputItem[]): Map<ResponseOutputItem, ResponseInputItem> {
  const retainedMessages = new Map<ResponseOutputItem, ResponseInputItem>();
  let remainingTokens = NATIVE_COMPACTION_RETAINED_MESSAGE_TOKEN_BUDGET;

  for (let index = outputItems.length - 1; index >= 0; index -= 1) {
    const item = outputItems[index];
    if (getNativeCompactionMessageRole(item) !== "user" || remainingTokens <= 0) {
      continue;
    }

    const tokenEstimate = estimateTokensFromText(describeInputContent((item as { content?: unknown }).content));
    if (tokenEstimate <= remainingTokens) {
      retainedMessages.set(item, item as unknown as ResponseInputItem);
      remainingTokens -= tokenEstimate;
      continue;
    }

    const truncatedItem = truncateRetainedUserMessage(item, remainingTokens);
    if (truncatedItem) {
      retainedMessages.set(item, truncatedItem);
    }
    remainingTokens = 0;
  }

  return retainedMessages;
}

export function mapNativeCompactionOutputItemsToInputItems(
  outputItems: ResponseOutputItem[]
): ResponseInputItem[] {
  const retainedUserMessages = limitRetainedNativeUserMessages(outputItems);
  return outputItems
    .flatMap((item) => {
      if (getNativeCompactionMessageRole(item) === "user") {
        const retainedItem = retainedUserMessages.get(item);
        return retainedItem ? [retainedItem] : [];
      }

      return shouldKeepNativeCompactionOutputItem(item) ? [item as unknown as ResponseInputItem] : [];
    });
}

export function describeInputContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    const segments: string[] = [];
    for (const part of content) {
      if (!isPlainObject(part)) {
        segments.push(safeStringify(part));
        continue;
      }

      if (part.type === "input_text" && typeof part.text === "string") {
        segments.push(part.text);
        continue;
      }

      if (part.type === "output_text" && typeof part.text === "string") {
        segments.push(part.text);
        continue;
      }

      segments.push(stringifyContextEstimateValue(part));
    }

    return segments.join("\n");
  }

  return stringifyContextEstimateValue(content);
}

export function estimateSystemMessageTokens(content: string): number {
  return estimateTokensFromText(content) + 12;
}

export function isCompactionMessagePayload(payload: Record<string, unknown>): boolean {
  return payload.kind === COMPACTION_MARKER_KIND;
}

export function resolveEffectiveCompactionBackend(input: CompactContextInput): {
  requestedBackend: CompactionBackendKind;
  backend: CompactionBackendKind;
  fallbackReason?: string;
} {
  const requestedBackend = input.compactionBackend ?? "summary";
  if (requestedBackend !== "native") {
    return {
      requestedBackend,
      backend: "summary"
    };
  }

  if (!providerSupportsNativeCompaction(input.provider)) {
    return {
      requestedBackend,
      backend: "summary",
      fallbackReason: "provider_unsupported"
    };
  }

  return {
    requestedBackend,
    backend: "native"
  };
}

export type { TaskMessageRow };
