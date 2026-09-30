import { appendMessage } from "../agent-db/index.js";
import { emitTaskEvent } from "../runtime/events.js";
import { compactWithNativeBackend } from "./native.js";
import { compactWithSummaryBackend } from "./summary.js";
import {
  AUTO_COMPACTION_ERROR_COOLDOWN_MS,
  AUTO_COMPACTION_THRESHOLD_RATIO,
  buildUsageSnapshot,
  COMPACTION_MARKER_KIND,
  emitContextUsage,
  estimateContextTokens,
  isAbortError,
  MAX_LIVE_TAIL_ITEM_COUNT,
  TARGET_POST_COMPACTION_RATIO,
  truncate,
  resolveEffectiveCompactionBackend,
  type CompactContextInput,
  type CompactContextResult
} from "./shared.js";
import { selectCompactionLiveTailItems } from "./summary.js";

const autoCompactionCooldownUntil = new Map<string, number>();
const nativeAutoCompactionVerificationUntil = new Map<string, number>();
const NATIVE_AUTO_COMPACTION_VERIFICATION_WINDOW_MS = 10 * 60 * 1000;

function buildTrimRecoveryMarkerText(reason: string | undefined): string {
  const recoveryReason = reason ? truncate(reason, 500) : null;
  return [
    "## Context Trim Recovery",
    "",
    "The previous model request exceeded the context window, and automatic context compaction could not produce a usable reduced context.",
    "Older raw conversation items were omitted so the task can continue within the model limit.",
    "If important details are missing, ask the user to resend them instead of guessing.",
    ...(recoveryReason ? ["", `Recovery reason: ${recoveryReason}`] : [])
  ].join("\n");
}

function buildTrimmedRecoveryConversation(input: {
  systemPrompt: string;
  conversationItems: CompactContextInput["conversationItems"];
  model: string;
  maxContextTokens: number;
  step: number;
  reason?: string;
}): {
  markerText: string;
  responseItems: CompactContextInput["conversationItems"];
  nextItems: CompactContextInput["conversationItems"];
  usageAfter: ReturnType<typeof buildUsageSnapshot>;
  liveTailCount: number;
} {
  const markerText = buildTrimRecoveryMarkerText(input.reason);
  const responseItems: CompactContextInput["conversationItems"] = [
    {
      role: "system",
      content: markerText
    }
  ];
  const trimSourceItems = input.conversationItems.filter((item) => {
    return !(typeof item === "object" && item !== null && "type" in item && item.type === "compaction");
  });
  let tailCount = Math.min(MAX_LIVE_TAIL_ITEM_COUNT, trimSourceItems.length);
  let liveTail = selectCompactionLiveTailItems(trimSourceItems, tailCount);
  let nextItems = [...responseItems, ...liveTail];
  let usageAfter = buildUsageSnapshot({
    usedTokens: estimateContextTokens(input.systemPrompt, nextItems, input.model),
    maxContextTokens: input.maxContextTokens,
    source: "estimate",
    stage: "post_compaction",
    step: input.step
  });

  while (tailCount > 0 && usageAfter.utilization > TARGET_POST_COMPACTION_RATIO) {
    tailCount -= 1;
    liveTail = selectCompactionLiveTailItems(trimSourceItems, tailCount);
    nextItems = [...responseItems, ...liveTail];
    usageAfter = buildUsageSnapshot({
      usedTokens: estimateContextTokens(input.systemPrompt, nextItems, input.model),
      maxContextTokens: input.maxContextTokens,
      source: "estimate",
      stage: "post_compaction",
      step: input.step
    });
  }

  return {
    markerText,
    responseItems,
    nextItems,
    usageAfter,
    liveTailCount: liveTail.length
  };
}

async function trimContextAfterCompactionFailure(
  input: CompactContextInput & {
    usageBefore: ReturnType<typeof buildUsageSnapshot>;
    reason?: string;
  }
): Promise<CompactContextResult> {
  const sourceItemCount = input.conversationItems.length;
  const trimmed = buildTrimmedRecoveryConversation({
    systemPrompt: input.systemPrompt,
    conversationItems: input.conversationItems,
    model: input.model,
    maxContextTokens: input.maxContextTokens,
    step: input.step,
    reason: input.reason
  });

  input.conversationItems.splice(0, input.conversationItems.length, ...trimmed.nextItems);
  input.runPersistedItems.length = 0;

  try {
    const markerMessageId = await appendMessage(
      input.taskId,
      "system",
      {
        kind: COMPACTION_MARKER_KIND,
        text: trimmed.markerText,
        summary_markdown: trimmed.markerText,
        response_items: trimmed.responseItems,
        compaction: {
          trigger: input.trigger,
          backend: "summary",
          recoveryFallback: "trim",
          reason: input.reason ?? null,
          sourceItemCount,
          liveTailItemCount: trimmed.liveTailCount,
          usageBefore: input.usageBefore,
          usageAfter: trimmed.usageAfter
        }
      },
      {
        parentMessageId: input.getCurrentLeafMessageId?.() ?? null
      }
    );
    input.setCurrentLeafMessageId?.(markerMessageId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emitTaskEvent(input.taskId, "error", {
      message: `Persisting context trim recovery marker failed: ${message}`,
      phase: "context_compaction",
      recoveryFallback: "trim"
    });
  }

  await emitContextUsage(input.taskId, trimmed.usageAfter);
  await emitTaskEvent(input.taskId, "compaction", {
    trigger: input.trigger,
    status: "completed",
    backend: "summary",
    recoveryFallback: "trim",
    reason: input.reason ?? null,
    usageBefore: input.usageBefore,
    usageAfter: trimmed.usageAfter,
    liveTailItemCount: trimmed.liveTailCount
  });

  return {
    status: "compacted",
    usageBefore: input.usageBefore,
    usageAfter: trimmed.usageAfter,
    backend: "summary",
    summaryMarkdown: trimmed.markerText
  };
}

async function compactContextInternal(
  input: CompactContextInput & {
    usageBefore?: ReturnType<typeof buildUsageSnapshot>;
    emitPreUsage?: boolean;
  }
): Promise<CompactContextResult> {
  if (input.abortSignal?.aborted) {
    throw new Error("TASK_CANCELLED");
  }

  const usageBefore =
    input.usageBefore ??
    buildUsageSnapshot({
      usedTokens: estimateContextTokens(input.systemPrompt, input.conversationItems, input.model),
      maxContextTokens: input.maxContextTokens,
      source: "estimate",
      stage: "pre_model_call",
      step: input.step
    });

  if (input.emitPreUsage !== false) {
    await emitContextUsage(input.taskId, usageBefore);
  }

  try {
    const { requestedBackend, backend, fallbackReason } = resolveEffectiveCompactionBackend(input);
    const preparedCompaction =
      backend === "native"
        ? await compactWithNativeBackend({
            compactInput: input,
            usageBefore,
            requestedBackend
          })
        : await compactWithSummaryBackend({
            compactInput: input,
            usageBefore,
            requestedBackend,
            fallbackReason
          });

    const markerMessageId = await appendMessage(
      input.taskId,
      "system",
      {
        kind: COMPACTION_MARKER_KIND,
        text: preparedCompaction.markerText,
        ...(preparedCompaction.summaryMarkdown ? { summary_markdown: preparedCompaction.summaryMarkdown } : {}),
        response_items: preparedCompaction.responseItems,
        ...preparedCompaction.messageMetadata
      },
      {
        parentMessageId: input.getCurrentLeafMessageId?.() ?? null
      }
    );
    if (input.setCurrentLeafMessageId) {
      input.setCurrentLeafMessageId(markerMessageId);
    }

    input.conversationItems.splice(0, input.conversationItems.length, ...preparedCompaction.nextItems);
    input.runPersistedItems.length = 0;

    await emitContextUsage(input.taskId, preparedCompaction.usageAfter);
    await emitTaskEvent(input.taskId, "compaction", {
      trigger: input.trigger,
      status: "completed",
      ...preparedCompaction.completionMetadata
    });

    return {
      status: "compacted",
      usageBefore,
      usageAfter: preparedCompaction.usageAfter,
      backend: preparedCompaction.backend,
      ...(preparedCompaction.summaryMarkdown ? { summaryMarkdown: preparedCompaction.summaryMarkdown } : {})
    };
  } catch (error) {
    if (
      (error instanceof Error && error.message === "TASK_CANCELLED")
      || (input.abortSignal?.aborted && isAbortError(error))
    ) {
      throw new Error("TASK_CANCELLED");
    }

    const message = error instanceof Error ? error.message : String(error);
    const { requestedBackend, backend, fallbackReason } = resolveEffectiveCompactionBackend(input);
    await emitTaskEvent(input.taskId, "compaction", {
      trigger: input.trigger,
      status: "error",
      backend,
      requestedBackend,
      ...(fallbackReason ? { backendFallbackReason: fallbackReason } : {}),
      message,
      usageBefore
    });

    return {
      status: "error",
      reason: message,
      usageBefore,
      backend
    };
  }
}

function buildAutoCompactionUsageSnapshot(input: {
  actualInputTokens?: number;
  estimatedInputTokensAtActualMeasurement?: number;
  systemPrompt: string;
  conversationItems: CompactContextInput["conversationItems"];
  model: string;
  maxContextTokens: number;
  step: number;
}): ReturnType<typeof buildUsageSnapshot> {
  const estimatedInputTokens = estimateContextTokens(input.systemPrompt, input.conversationItems, input.model);
  const actualInputTokens = input.actualInputTokens;
  const estimatedInputTokensAtActualMeasurement = input.estimatedInputTokensAtActualMeasurement;
  if (
    typeof actualInputTokens === "number"
    && Number.isFinite(actualInputTokens)
    && typeof estimatedInputTokensAtActualMeasurement === "number"
    && Number.isFinite(estimatedInputTokensAtActualMeasurement)
  ) {
    return buildUsageSnapshot({
      usedTokens: Math.max(0, Math.floor(actualInputTokens + estimatedInputTokens - estimatedInputTokensAtActualMeasurement)),
      maxContextTokens: input.maxContextTokens,
      source: "actual",
      stage: "pre_model_call",
      step: input.step
    });
  }

  return buildUsageSnapshot({
    usedTokens: estimatedInputTokens,
    maxContextTokens: input.maxContextTokens,
    source: "estimate",
    stage: "pre_model_call",
    step: input.step
  });
}

export async function maybeAutoCompactContext(
  input: Omit<CompactContextInput, "trigger"> & {
    emitPreUsage?: boolean;
    actualInputTokens?: number;
    estimatedInputTokensAtActualMeasurement?: number;
  }
): Promise<CompactContextResult> {
  if (input.abortSignal?.aborted) {
    throw new Error("TASK_CANCELLED");
  }

  const usageBefore = buildAutoCompactionUsageSnapshot(input);
  const now = Date.now();
  const nativeVerificationUntil = nativeAutoCompactionVerificationUntil.get(input.taskId) ?? 0;
  if (nativeVerificationUntil <= now) {
    nativeAutoCompactionVerificationUntil.delete(input.taskId);
  } else if (usageBefore.source === "actual") {
    nativeAutoCompactionVerificationUntil.delete(input.taskId);
    if (usageBefore.utilization >= AUTO_COMPACTION_THRESHOLD_RATIO) {
      return trimContextAfterCompactionFailure({
        ...input,
        trigger: "auto",
        usageBefore,
        reason: "Native context compaction did not reduce the provider-reported context before the next model turn."
      });
    }
  }

  if (input.emitPreUsage !== false) {
    await emitContextUsage(input.taskId, usageBefore);
  }

  if (usageBefore.utilization < AUTO_COMPACTION_THRESHOLD_RATIO) {
    return {
      status: "skipped",
      reason: "below_threshold",
      usageBefore
    };
  }

  const cooldownUntil = autoCompactionCooldownUntil.get(input.taskId) ?? 0;
  if (cooldownUntil > now) {
    return {
      status: "skipped",
      reason: "cooldown",
      usageBefore
    };
  }

  const result = await compactContextInternal({
    ...input,
    trigger: "auto",
    usageBefore,
    emitPreUsage: false
  });

  if (result.status === "error") {
    autoCompactionCooldownUntil.set(input.taskId, now + AUTO_COMPACTION_ERROR_COOLDOWN_MS);
  } else if (result.backend === "native") {
    nativeAutoCompactionVerificationUntil.set(
      input.taskId,
      now + NATIVE_AUTO_COMPACTION_VERIFICATION_WINDOW_MS
    );
  }

  return result;
}

export async function compactContextNow(input: Omit<CompactContextInput, "trigger">): Promise<CompactContextResult> {
  if (input.abortSignal?.aborted) {
    throw new Error("TASK_CANCELLED");
  }

  return compactContextInternal({
    ...input,
    trigger: "manual"
  });
}

export async function recoverContextAfterContextWindowError(
  input: Omit<CompactContextInput, "trigger"> & {
    reason?: string;
  }
): Promise<CompactContextResult> {
  if (input.abortSignal?.aborted) {
    throw new Error("TASK_CANCELLED");
  }

  const usageBefore = buildUsageSnapshot({
    usedTokens: estimateContextTokens(input.systemPrompt, input.conversationItems, input.model),
    maxContextTokens: input.maxContextTokens,
    source: "estimate",
    stage: "pre_model_call",
    step: input.step
  });

  const compactResult = await compactContextInternal({
    ...input,
    trigger: "recovery",
    usageBefore
  });

  if (compactResult.status === "compacted") {
    return compactResult;
  }

  return trimContextAfterCompactionFailure({
    ...input,
    trigger: "recovery",
    usageBefore,
    reason: compactResult.reason ?? input.reason
  });
}

export async function emitActualContextUsage(input: {
  taskId: string;
  step: number;
  maxContextTokens: number;
  inputTokens: number;
  cachedTokens?: number;
  prefixHash?: string;
  promptRevision?: string;
}): Promise<void> {
  const usage = buildUsageSnapshot({
    usedTokens: input.inputTokens,
    maxContextTokens: input.maxContextTokens,
    source: "actual",
    stage: "post_model_response",
    step: input.step,
    cachedTokens: input.cachedTokens,
    prefixHash: input.prefixHash,
    promptRevision: input.promptRevision
  });

  await emitContextUsage(input.taskId, usage);
}
