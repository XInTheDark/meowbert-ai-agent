import { randomUUID } from "node:crypto";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { extractObjectWithToolCall } from "../../lib/openai-tool-output.js";
import { emitTaskEvent } from "../runtime/events.js";
import { getOpenAiClient } from "../agent/openai-client.js";
import {
  buildUsageSnapshot,
  COMPACTION_INPUT_MAX_UTILIZATION,
  COMPACTION_OUTPUT_SCHEMA,
  COMPACTION_STATE_VERSION,
  COMPACTION_SUMMARY_MAX_ATTEMPTS,
  COMPACTION_SUMMARY_RETRY_BASE_DELAY_MS,
  COMPACTION_SYSTEM_PROMPT,
  COMPACTION_TOOL_NAME,
  estimateContextTokens,
  estimateSystemMessageTokens,
  estimateTokensFromText,
  getMaxContextWindowTokens,
  isAbortError,
  MAX_LIVE_TAIL_ITEM_COUNT,
  MAX_SERIALIZED_ITEM_CHARS,
  MIN_LIVE_TAIL_ITEM_COUNT,
  safeStringify,
  stringifyContextEstimateValue,
  truncate,
  truncateWithOptionalLimit,
  type CompactContextInput,
  type CompactionBackendKind,
  type CompactionHistoryPreparation,
  type CompactionStateSegment,
  type CompactionTrigger,
  type CompactionStructuredOutput,
  type ConversationCompactionState,
  type PreparedCompactionResult
} from "./shared.js";

interface SerializedConversationItem {
  index: number;
  descriptor: string;
  body: string;
}

interface CompactionAttemptPlanItem {
  model: string;
  label: string;
}

function serializeConversationItem(item: ResponseInputItem, index: number): SerializedConversationItem {
  const record = item as unknown as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role : null;
  const type = typeof record.type === "string" ? record.type : null;

  if (role) {
    return {
      index,
      descriptor: `role=${role}`,
      body: describeSerializedContent(record.content)
    };
  }

  if (type === "function_call") {
    const name = typeof record.name === "string" ? record.name : "unknown";
    const callId = typeof record.call_id === "string" ? record.call_id : "unknown";
    const args = typeof record.arguments === "string" ? record.arguments : safeStringify(record.arguments);
    return {
      index,
      descriptor: `type=function_call name=${name} call_id=${callId}`,
      body: args
    };
  }

  if (type === "function_call_output") {
    const callId = typeof record.call_id === "string" ? record.call_id : "unknown";
    return {
      index,
      descriptor: `type=function_call_output call_id=${callId}`,
      body: describeSerializedContent(record.output)
    };
  }

  if (type === "reasoning") {
    const summary = describeSerializedContent(record.summary);
    const encryptedContent =
      record.encrypted_content !== undefined && record.encrypted_content !== null
        ? safeStringify(record.encrypted_content)
        : "";
    return {
      index,
      descriptor: "type=reasoning",
      body:
        encryptedContent.length > 0
          ? [summary, "", "[encrypted_content]", encryptedContent].join("\n")
          : summary
    };
  }

  if (type === "compaction") {
    const encryptedContentLength =
      typeof record.encrypted_content === "string" ? record.encrypted_content.length : 0;
    return {
      index,
      descriptor: "type=compaction",
      body:
        encryptedContentLength > 0
          ? `Opaque native compaction item (encrypted_content length=${encryptedContentLength}).`
          : "Opaque native compaction item."
    };
  }

  return {
    index,
    descriptor: `type=${type ?? "unknown"}`,
    body: safeStringify(item)
  };
}

function describeSerializedContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return stringifyContextEstimateValue(content);
  }

  return content
    .map((part) => {
      if (typeof part !== "object" || part === null) {
        return safeStringify(part);
      }

      if ((part as { type?: string }).type === "input_text" && typeof (part as { text?: string }).text === "string") {
        return (part as { text: string }).text;
      }

      if ((part as { type?: string }).type === "output_text" && typeof (part as { text?: string }).text === "string") {
        return (part as { text: string }).text;
      }

      return stringifyContextEstimateValue(part);
    })
    .join("\n");
}

function renderSerializedConversationHistory(
  serializedItems: SerializedConversationItem[],
  perItemCharLimit: number | null
): string {
  if (serializedItems.length === 0) {
    return "(no conversation items)";
  }

  return serializedItems
    .map((item) => {
      const body = truncateWithOptionalLimit(item.body, perItemCharLimit);
      return `${item.index}. [${item.descriptor}]\n${body}`;
    })
    .join("\n\n");
}

function splitSerializedConversationItem(
  item: SerializedConversationItem,
  bodyCharLimit: number
): SerializedConversationItem[] {
  if (item.body.length <= bodyCharLimit) {
    return [item];
  }

  const fragmentCount = Math.ceil(item.body.length / bodyCharLimit);
  return Array.from({ length: fragmentCount }, (_, fragmentIndex) => ({
    index: item.index,
    descriptor: `${item.descriptor} fragment=${fragmentIndex + 1}/${fragmentCount}`,
    body: item.body.slice(fragmentIndex * bodyCharLimit, (fragmentIndex + 1) * bodyCharLimit)
  }));
}

function buildCompactionUserPrompt(maxContextTokens: number, conversationHistory: string): string {
  return [
    "Compact the following conversation history.",
    `Context window max tokens: ${maxContextTokens}`,
    `Choose live_tail_start_index so the live tail keeps between ${MIN_LIVE_TAIL_ITEM_COUNT} and ${MAX_LIVE_TAIL_ITEM_COUNT} most-recent raw items verbatim.`,
    "Use the earliest 1-based conversation item index that should remain raw after the summary. Prefer keeping unresolved tool calls, very recent user intent, and any immediate execution context.",
    "",
    "Conversation history (numbered):",
    conversationHistory
  ].join("\n");
}

function estimateCompactionRequestTokens(maxContextTokens: number, conversationHistory: string): number {
  const userPrompt = buildCompactionUserPrompt(maxContextTokens, conversationHistory);
  return estimateTokensFromText(COMPACTION_SYSTEM_PROMPT) + 16 + estimateTokensFromText(userPrompt) + 8;
}

function estimateSerializedHistoryTokens(maxContextTokens: number, conversationHistory: string): number {
  return estimateCompactionRequestTokens(Math.max(1, maxContextTokens), conversationHistory);
}

export function prepareConversationHistoryChunksForCompaction(input: {
  conversationItems: ResponseInputItem[];
  compactionModel: string;
  platformModelMetadata?: CompactContextInput["platformModelMetadata"];
  maxContextTokens: number;
}): CompactionHistoryPreparation[] {
  const targetTokens = Math.max(
    1,
    Math.floor(
      Math.min(
        input.maxContextTokens,
        getMaxContextWindowTokens(input.compactionModel, input.platformModelMetadata ?? {})
      ) * COMPACTION_INPUT_MAX_UTILIZATION
    )
  );

  const bodyCharLimit = Math.max(
    256,
    Math.min(MAX_SERIALIZED_ITEM_CHARS, Math.floor(targetTokens * 4))
  );
  const serializedItems = input.conversationItems.flatMap((item, index) =>
    splitSerializedConversationItem(serializeConversationItem(item, index + 1), bodyCharLimit)
  );
  const chunks: CompactionHistoryPreparation[] = [];
  let currentItems: SerializedConversationItem[] = [];

  const appendChunk = (): void => {
    if (currentItems.length === 0) {
      return;
    }

    const conversationHistory = renderSerializedConversationHistory(currentItems, bodyCharLimit);
    const estimatedInputTokens = estimateSerializedHistoryTokens(input.maxContextTokens, conversationHistory);
    const sourceIndexes = currentItems.map((item) => item.index);
    const sourceStartIndex = Math.min(...sourceIndexes);
    const sourceEndIndex = Math.max(...sourceIndexes);
    chunks.push({
      conversationHistory,
      estimatedInputTokens,
      estimatedInputUtilization: Math.min(1, estimatedInputTokens / Math.max(1, input.maxContextTokens)),
      itemCharLimit: bodyCharLimit,
      wasTruncated: false,
      includedItemCount: new Set(sourceIndexes).size,
      omittedItemCount: 0,
      reductionReason: "none",
      sourceStartIndex,
      sourceEndIndex
    });
    currentItems = [];
  };

  for (const serializedItem of serializedItems) {
    const candidateItems = [...currentItems, serializedItem];
    const candidateHistory = renderSerializedConversationHistory(candidateItems, bodyCharLimit);
    const candidateTokens = estimateSerializedHistoryTokens(input.maxContextTokens, candidateHistory);
    if (currentItems.length > 0 && candidateTokens > targetTokens) {
      appendChunk();
    }
    currentItems.push(serializedItem);
  }
  appendChunk();

  return chunks;
}

function buildCompactionMarkerText(summaryMarkdown: string): string {
  return ["## Context Compaction", "", summaryMarkdown.trim()].join("\n").trim();
}

function buildCompactionSegmentSystemMessage(
  segment: CompactionStateSegment,
  index: number,
  total: number
): string {
  return [
    `[Compacted context segment ${index}/${total}]`,
    `Source items: ${segment.source_item_count}`,
    `Source tokens≈${segment.source_token_estimate}, summary tokens≈${segment.summary_token_estimate}`,
    `Model: ${segment.model} (${segment.trigger})`,
    segment.summary_markdown
  ].join("\n");
}

function buildSummaryResponseItemsFromState(input: {
  state: ConversationCompactionState;
}): { responseItems: ResponseInputItem[]; summaryTokenEstimate: number; includedSegments: number } {
  const { segments } = input.state;
  if (segments.length === 0) {
    return { responseItems: [], summaryTokenEstimate: 0, includedSegments: 0 };
  }

  const responseItems: ResponseInputItem[] = segments.map((segment, index) => ({
    role: "system",
    content: buildCompactionSegmentSystemMessage(segment, index + 1, segments.length)
  }));
  const summaryTokenEstimate = responseItems.reduce((total, item) => {
    const content = (item as { content?: unknown }).content;
    return total + estimateSystemMessageTokens(typeof content === "string" ? content : "");
  }, 0);

  return {
    responseItems,
    summaryTokenEstimate,
    includedSegments: segments.length
  };
}

function getToolCallIdentity(item: ResponseInputItem): { callId: string; kind: string; output: boolean } | null {
  if (typeof item !== "object" || item === null || !("type" in item) || !("call_id" in item)) {
    return null;
  }

  const record = item as unknown as { type?: unknown; call_id?: unknown };
  if (typeof record.type !== "string" || typeof record.call_id !== "string") {
    return null;
  }

  const pairs: Record<string, { kind: string; output: boolean }> = {
    function_call: { kind: "function", output: false },
    function_call_output: { kind: "function", output: true },
    custom_tool_call: { kind: "custom", output: false },
    custom_tool_call_output: { kind: "custom", output: true },
    apply_patch_call: { kind: "apply_patch", output: false },
    apply_patch_call_output: { kind: "apply_patch", output: true }
  };
  const pair = pairs[record.type];
  return pair ? { callId: record.call_id, ...pair } : null;
}

function isReasoningInputItem(item: ResponseInputItem): boolean {
  return typeof item === "object" && item !== null && "type" in item && item.type === "reasoning";
}

export function normalizeCompactionLiveTailStartIndex(input: {
  requestedStartIndex: number;
  sourceItemCount: number;
}): number {
  const sourceItemCount = Math.max(0, Math.floor(input.sourceItemCount));
  if (sourceItemCount === 0) {
    return 1;
  }

  const minimumTailCount = Math.min(MIN_LIVE_TAIL_ITEM_COUNT, sourceItemCount);
  const maximumTailCount = Math.min(MAX_LIVE_TAIL_ITEM_COUNT, sourceItemCount);
  const earliestAllowedIndex = sourceItemCount - maximumTailCount + 1;
  const latestAllowedIndex = sourceItemCount - minimumTailCount + 1;
  const requestedStartIndex = Number.isFinite(input.requestedStartIndex)
    ? Math.floor(input.requestedStartIndex)
    : latestAllowedIndex;
  return Math.min(latestAllowedIndex, Math.max(earliestAllowedIndex, requestedStartIndex));
}

export function selectCompactionLiveTailItems(
  priorConversationItems: ResponseInputItem[],
  desiredTailCount: number
): ResponseInputItem[] {
  if (desiredTailCount <= 0 || priorConversationItems.length === 0) {
    return [];
  }

  let startIndex = Math.max(0, priorConversationItems.length - desiredTailCount);
  const requiredCalls = new Map<string, string>();
  const initialTail = priorConversationItems.slice(startIndex);
  for (const item of initialTail) {
    const identity = getToolCallIdentity(item);
    if (identity?.output) {
      requiredCalls.set(identity.callId, identity.kind);
    }
  }
  for (const item of initialTail) {
    const identity = getToolCallIdentity(item);
    if (identity && !identity.output && requiredCalls.get(identity.callId) === identity.kind) {
      requiredCalls.delete(identity.callId);
    }
  }

  let expandedStartIndex = startIndex;
  for (const [requiredCallId, requiredKind] of requiredCalls) {
    for (let index = startIndex - 1; index >= 0; index -= 1) {
      const identity = getToolCallIdentity(priorConversationItems[index]);
      if (
        identity
        && !identity.output
        && identity.callId === requiredCallId
        && identity.kind === requiredKind
      ) {
        let groupStartIndex = index;
        while (groupStartIndex > 0 && isReasoningInputItem(priorConversationItems[groupStartIndex - 1])) {
          groupStartIndex -= 1;
        }
        expandedStartIndex = Math.min(expandedStartIndex, groupStartIndex);
        break;
      }
    }
  }

  return priorConversationItems.slice(expandedStartIndex);
}

function buildCompactedConversation(input: {
  summaryItems: ResponseInputItem[];
  priorConversationItems: ResponseInputItem[];
  model: string;
  systemPrompt: string;
  maxContextTokens: number;
  step: number;
  liveTailStartIndex: number;
}): { nextItems: ResponseInputItem[]; usageAfter: ReturnType<typeof buildUsageSnapshot>; liveTailCount: number } {
  const summaryItems =
    input.summaryItems.length > 0
      ? input.summaryItems
      : ([{ role: "system", content: "## Context Compaction\n\nSummary unavailable." }] as ResponseInputItem[]);

  const rawTailCount = input.priorConversationItems.length - input.liveTailStartIndex + 1;
  const tailCount = Math.min(
    MAX_LIVE_TAIL_ITEM_COUNT,
    Math.max(MIN_LIVE_TAIL_ITEM_COUNT, rawTailCount)
  );
  const tailItems = selectCompactionLiveTailItems(input.priorConversationItems, tailCount);
  const nextItems = [...summaryItems, ...tailItems];
  const usageAfter = buildUsageSnapshot({
    usedTokens: estimateContextTokens(input.systemPrompt, nextItems, input.model),
    maxContextTokens: input.maxContextTokens,
    source: "estimate",
    stage: "post_compaction",
    step: input.step
  });

  return {
    nextItems,
    usageAfter,
    liveTailCount: tailItems.length
  };
}

function buildCompactionState(input: {
  summaries: CompactionStructuredOutput[];
  model: string;
  trigger: CompactionTrigger;
  sourceItemCount: number;
  sourceTokenEstimate: number;
  histories: CompactionHistoryPreparation[];
}): ConversationCompactionState {
  const now = new Date().toISOString();
  const segments: CompactionStateSegment[] = input.summaries.map((summary, index) => {
    const history = input.histories[index];
    return {
      id: randomUUID(),
      created_at: now,
      summary_markdown: summary.summary_markdown,
      model: input.model,
      trigger: input.trigger,
      source_item_count: history.includedItemCount,
      source_start_index: history.sourceStartIndex,
      source_end_index: history.sourceEndIndex,
      source_token_estimate: history.estimatedInputTokens,
      summary_token_estimate: estimateSystemMessageTokens(summary.summary_markdown),
      serialization: {
        was_truncated: history.wasTruncated,
        item_char_limit: history.itemCharLimit,
        estimated_input_tokens: history.estimatedInputTokens,
        estimated_input_utilization: history.estimatedInputUtilization
      }
    };
  });

  return {
    version: COMPACTION_STATE_VERSION,
    updated_at: now,
    segments,
    source_item_count: input.sourceItemCount,
    source_token_estimate: input.sourceTokenEstimate,
    summary_token_estimate: segments.reduce((total, segment) => total + segment.summary_token_estimate, 0)
  };
}

async function summarizeConversationChunk(input: {
  taskId: string;
  provider: CompactContextInput["provider"];
  model: string;
  requestTimeoutMs?: number;
  abortSignal?: AbortSignal;
  maxContextTokens: number;
  conversationHistory: string;
}): Promise<CompactionStructuredOutput> {
  const client = getOpenAiClient(input.provider);
  const extraction = await extractObjectWithToolCall<CompactionStructuredOutput>({
    client,
    model: input.model,
    toolName: COMPACTION_TOOL_NAME,
    toolDescription: "Return a compact but detailed conversation continuity package.",
    schema: COMPACTION_OUTPUT_SCHEMA,
    requestTimeoutMs: input.requestTimeoutMs,
    abortSignal: input.abortSignal,
    maxAttempts: COMPACTION_SUMMARY_MAX_ATTEMPTS,
    baseRetryDelayMs: COMPACTION_SUMMARY_RETRY_BASE_DELAY_MS,
    onRetry: async (context) => {
      const retryMsg = [
        `Context compaction model call failed (attempt ${context.attempt}/${context.maxAttempts})`,
        `${context.error.message}.`,
        `Retrying in ${(context.delayMs / 1000).toFixed(0)}s...`
      ].join(" ");
      await emitTaskEvent(input.taskId, "error", {
        message: retryMsg,
        phase: "context_compaction",
        attempt: context.attempt,
        maxAttempts: context.maxAttempts,
        retrying: true
      });
    },
    input: [
      { role: "system", content: COMPACTION_SYSTEM_PROMPT },
      {
        role: "user",
        content: buildCompactionUserPrompt(input.maxContextTokens, input.conversationHistory)
      }
    ]
  });

  if (!extraction.ok) {
    throw new Error(extraction.error);
  }

  return extraction.value;
}

function buildCompactionPlan(compactInput: CompactContextInput): CompactionAttemptPlanItem[] {
  return [{ model: compactInput.model, label: "current_model" }];
}

function buildCompactionInputMetadata(
  preparedHistories: CompactionHistoryPreparation[],
  sourceItemCount: number
): Record<string, unknown> {
  return {
    estimatedTokens: preparedHistories.reduce((total, history) => total + history.estimatedInputTokens, 0),
    maxChunkEstimatedTokens: preparedHistories.reduce(
      (maximum, history) => Math.max(maximum, history.estimatedInputTokens),
      0
    ),
    chunkCount: preparedHistories.length,
    utilization: Math.max(...preparedHistories.map((history) => history.estimatedInputUtilization)),
    wasTruncated: preparedHistories.some((history) => history.wasTruncated),
    itemCharLimit: preparedHistories[0]?.itemCharLimit ?? MAX_SERIALIZED_ITEM_CHARS,
    includedItemCount: sourceItemCount,
    omittedItemCount: 0,
    reductionMode: preparedHistories.length > 1 ? "summarize_in_chunks" : "none"
  };
}

async function emitSummaryCompactionStart(input: {
  compactInput: CompactContextInput;
  usageBefore: ReturnType<typeof buildUsageSnapshot>;
  requestedBackend: CompactionBackendKind;
  fallbackReason?: string;
  plan: CompactionAttemptPlanItem[];
  preparedHistories: CompactionHistoryPreparation[];
}): Promise<void> {
  await emitTaskEvent(input.compactInput.taskId, "compaction", {
    trigger: input.compactInput.trigger,
    status: "started",
    backend: "summary",
    requestedBackend: input.requestedBackend,
    ...(input.fallbackReason ? { backendFallbackReason: input.fallbackReason } : {}),
    model: input.plan[0].model,
    sourceItemCount: input.compactInput.conversationItems.length,
    compactionInput: buildCompactionInputMetadata(
      input.preparedHistories,
      input.compactInput.conversationItems.length
    ),
    fallbackPlan: input.plan.map((item) => ({
      model: item.model,
      label: item.label
    })),
    usageBefore: input.usageBefore
  });
}

async function runSummaryCompactionPlan(input: {
  compactInput: CompactContextInput;
  plan: CompactionAttemptPlanItem[];
  preparedHistories: CompactionHistoryPreparation[];
}): Promise<{
  structured: CompactionStructuredOutput[];
  compactionModel: string;
}> {
  const structured: CompactionStructuredOutput[] = [];
  const compactionModel = input.plan[0].model;
  let lastCompactionError = "Context compaction failed with an unknown error.";

  for (let index = 0; index < input.preparedHistories.length; index += 1) {
    const preparedHistory = input.preparedHistories[index];
    try {
      const chunkSummary = await summarizeConversationChunk({
        taskId: input.compactInput.taskId,
        provider: input.compactInput.provider,
        model: compactionModel,
        requestTimeoutMs: input.compactInput.requestTimeoutMs,
        abortSignal: input.compactInput.abortSignal,
        maxContextTokens: input.compactInput.maxContextTokens,
        conversationHistory: preparedHistory.conversationHistory
      });
      structured.push(chunkSummary);
    } catch (error) {
      if (
        (error instanceof Error && error.message === "TASK_CANCELLED")
        || (input.compactInput.abortSignal?.aborted && isAbortError(error))
      ) {
        throw new Error("TASK_CANCELLED");
      }

      lastCompactionError = error instanceof Error ? error.message : String(error);
      await emitTaskEvent(input.compactInput.taskId, "error", {
        message: [
          `Context compaction chunk ${index + 1}/${input.preparedHistories.length} failed.`,
          `Source items ${preparedHistory.sourceStartIndex}-${preparedHistory.sourceEndIndex}, input≈${preparedHistory.estimatedInputTokens} tokens.`,
          lastCompactionError
        ].join(" "),
        phase: "context_compaction",
        attempt: index + 1,
        maxAttempts: input.preparedHistories.length,
        retrying: false
      });
      throw new Error(lastCompactionError);
    }
  }

  if (structured.length !== input.preparedHistories.length) {
    throw new Error(lastCompactionError);
  }

  return {
    structured,
    compactionModel
  };
}

export async function compactWithSummaryBackend(input: {
  compactInput: CompactContextInput;
  usageBefore: ReturnType<typeof buildUsageSnapshot>;
  requestedBackend: CompactionBackendKind;
  fallbackReason?: string;
}): Promise<PreparedCompactionResult> {
  const plan = buildCompactionPlan(input.compactInput);
  if (plan.length === 0) {
    throw new Error("No valid compaction strategies were generated.");
  }

  const preparedHistories = prepareConversationHistoryChunksForCompaction({
    conversationItems: input.compactInput.conversationItems,
    compactionModel: plan[0].model,
    platformModelMetadata: input.compactInput.platformModelMetadata,
    maxContextTokens: input.compactInput.maxContextTokens
  });
  await emitSummaryCompactionStart({
    compactInput: input.compactInput,
    usageBefore: input.usageBefore,
    requestedBackend: input.requestedBackend,
    fallbackReason: input.fallbackReason,
    plan,
    preparedHistories
  });

  const { structured, compactionModel } =
    await runSummaryCompactionPlan({
      compactInput: input.compactInput,
      plan,
      preparedHistories
    });

  const sourceItemCount = input.compactInput.conversationItems.length;
  const summaryMarkdown = structured
    .map((summary, index) => (
      structured.length === 1
        ? summary.summary_markdown.trim()
        : `### Summary chunk ${index + 1}/${structured.length}\n\n${summary.summary_markdown.trim()}`
    ))
    .join("\n\n");
  const markerText = buildCompactionMarkerText(summaryMarkdown);
  const compactionState = buildCompactionState({
    summaries: structured,
    model: compactionModel,
    trigger: input.compactInput.trigger,
    sourceItemCount,
    sourceTokenEstimate: input.usageBefore.usedTokens,
    histories: preparedHistories
  });
  const summaryPayload = buildSummaryResponseItemsFromState({
    state: compactionState
  });
  const requestedLiveTailStartIndex = structured.at(-1)?.live_tail_start_index ?? sourceItemCount;
  const liveTailStartIndex = normalizeCompactionLiveTailStartIndex({
    requestedStartIndex: requestedLiveTailStartIndex,
    sourceItemCount
  });
  const compacted = buildCompactedConversation({
    summaryItems: summaryPayload.responseItems,
    priorConversationItems: input.compactInput.conversationItems,
    model: input.compactInput.model,
    systemPrompt: input.compactInput.systemPrompt,
    maxContextTokens: input.compactInput.maxContextTokens,
    step: input.compactInput.step,
    liveTailStartIndex
  });

  return {
    backend: "summary",
    model: compactionModel,
    markerText,
    summaryMarkdown,
    responseItems: compacted.nextItems,
    nextItems: compacted.nextItems,
    usageAfter: compacted.usageAfter,
    messageMetadata: {
      compaction_state: compactionState,
      compaction: {
        trigger: input.compactInput.trigger,
        backend: "summary",
        requestedBackend: input.requestedBackend,
        ...(input.fallbackReason ? { backendFallbackReason: input.fallbackReason } : {}),
        model: compactionModel,
        sourceItemCount,
        liveTailItemCount: compacted.liveTailCount,
        liveTailStartIndex,
        requestedLiveTailStartIndex,
        summarySegmentCount: summaryPayload.includedSegments,
        summaryTokenEstimate: summaryPayload.summaryTokenEstimate,
        compactionInput: buildCompactionInputMetadata(preparedHistories, sourceItemCount),
        usageBefore: input.usageBefore,
        usageAfter: compacted.usageAfter
      }
    },
    completionMetadata: {
      backend: "summary",
      requestedBackend: input.requestedBackend,
      ...(input.fallbackReason ? { backendFallbackReason: input.fallbackReason } : {}),
      model: compactionModel,
      usageBefore: input.usageBefore,
      usageAfter: compacted.usageAfter,
      liveTailItemCount: compacted.liveTailCount,
      liveTailStartIndex,
      requestedLiveTailStartIndex,
      summarySegmentCount: summaryPayload.includedSegments,
      fallbackPlanLength: plan.length,
      summaryPreview: truncate(summaryMarkdown, 500)
    }
  };
}
