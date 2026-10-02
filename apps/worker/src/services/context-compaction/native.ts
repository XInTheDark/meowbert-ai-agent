import type { Response, ResponseInputItem } from "openai/resources/responses/responses";
import { streamResponseToFinal } from "@meowbert/shared";
import { emitTaskEvent } from "../runtime/events.js";
import { getOpenAiClient } from "../agent/openai-client.js";
import { platformUsageRecorder } from "../tasks/platform-usage.js";
import { buildChatGptCodexProvider } from "../agent/chatgpt-request.js";
import {
  buildUsageSnapshot,
  estimateContextTokens,
  mapNativeCompactionOutputItemsToInputItems,
  NATIVE_COMPACTION_PLACEHOLDER_MARKDOWN,
  NATIVE_COMPACTION_PROVIDER_ERROR,
  providerSupportsNativeCompaction,
  resolveCompactionRequestTimeoutMs,
  type CompactContextInput,
  type CompactionBackendKind,
  type ContextUsageSnapshot,
  type PreparedCompactionResult
} from "./shared.js";

function buildNativeCompactedConversation(input: {
  compactedResponse: Response;
  model: string;
  systemPrompt: string;
  maxContextTokens: number;
  step: number;
}): {
  responseItems: ResponseInputItem[];
  nextItems: ResponseInputItem[];
  usageAfter: ContextUsageSnapshot;
  compactionItemCount: number;
} {
  const responseItems = mapNativeCompactionOutputItemsToInputItems(input.compactedResponse.output);
  const compactionItemCount = responseItems.filter((item) => {
    const record = item as unknown as Record<string, unknown>;
    return record.type === "compaction";
  }).length;

  if (responseItems.length === 0 || compactionItemCount === 0) {
    throw new Error("Native context compaction returned no usable compaction items.");
  }

  const usageAfter = buildUsageSnapshot({
    usedTokens: estimateContextTokens(input.systemPrompt, responseItems, input.model),
    maxContextTokens: input.maxContextTokens,
    source: "estimate",
    stage: "post_compaction",
    step: input.step
  });

  return {
    responseItems,
    nextItems: [...responseItems],
    usageAfter,
    compactionItemCount
  };
}

async function compactConversationNative(input: {
  provider: CompactContextInput["provider"];
  taskId: string;
  model: string;
  requestTimeoutMs?: number;
  abortSignal?: AbortSignal;
  systemPrompt: string;
  conversationItems: ResponseInputItem[];
}): Promise<Response> {
  if (!providerSupportsNativeCompaction(input.provider)) {
    throw new Error(NATIVE_COMPACTION_PROVIDER_ERROR);
  }

  const client = getOpenAiClient(buildChatGptCodexProvider(input.provider, input.taskId));
  return await streamResponseToFinal(
    client,
    {
      model: input.model,
      instructions: input.systemPrompt,
      input: [
        ...input.conversationItems,
        { type: "compaction_trigger" } as unknown as ResponseInputItem
      ],
      store: false
    },
    {
      maxRetries: 0,
      timeout: resolveCompactionRequestTimeoutMs(input.requestTimeoutMs),
      ...(input.abortSignal ? { signal: input.abortSignal } : {})
    }
  );
}

export async function compactWithNativeBackend(input: {
  compactInput: CompactContextInput;
  usageBefore: ContextUsageSnapshot;
  requestedBackend: CompactionBackendKind;
}): Promise<PreparedCompactionResult> {
  const { compactInput, usageBefore } = input;
  const compactionModel = compactInput.model;

  await emitTaskEvent(compactInput.taskId, "compaction", {
    trigger: compactInput.trigger,
    status: "started",
    backend: "native",
    requestedBackend: input.requestedBackend,
    model: compactionModel,
    sourceItemCount: compactInput.conversationItems.length,
    usageBefore
  });

  const compactedResponse = await compactConversationNative({
    provider: compactInput.provider,
    taskId: compactInput.taskId,
    model: compactionModel,
    requestTimeoutMs: compactInput.requestTimeoutMs,
    abortSignal: compactInput.abortSignal,
    systemPrompt: compactInput.systemPrompt,
    conversationItems: compactInput.conversationItems
  });
  await platformUsageRecorder.recordResponseUsage(compactInput.billing, compactionModel, compactedResponse.usage);

  const compacted = buildNativeCompactedConversation({
    compactedResponse,
    model: compactInput.model,
    systemPrompt: compactInput.systemPrompt,
    maxContextTokens: compactInput.maxContextTokens,
    step: compactInput.step
  });

  const compactionItem = compacted.responseItems.find((item) => {
    const record = item as unknown as Record<string, unknown>;
    return record.type === "compaction";
  }) as (ResponseInputItem & { id?: string; encrypted_content?: string }) | undefined;
  const encryptedContentLength =
    typeof compactionItem?.encrypted_content === "string" ? compactionItem.encrypted_content.length : 0;

  return {
    backend: "native",
    model: compactionModel,
    markerText: NATIVE_COMPACTION_PLACEHOLDER_MARKDOWN,
    summaryMarkdown: NATIVE_COMPACTION_PLACEHOLDER_MARKDOWN,
    responseItems: compacted.responseItems,
    nextItems: compacted.nextItems,
    usageAfter: compacted.usageAfter,
    messageMetadata: {
      compaction: {
        trigger: compactInput.trigger,
        backend: "native",
        requestedBackend: input.requestedBackend,
        model: compactionModel,
        sourceItemCount: compactInput.conversationItems.length,
        retainedItemCount: compacted.responseItems.length,
        compactionItemCount: compacted.compactionItemCount,
        compactionResponseId: compactedResponse.id,
        ...(typeof compactionItem?.id === "string" ? { compactionItemId: compactionItem.id } : {}),
        encryptedContentLength,
        apiUsage: {
          inputTokens: compactedResponse.usage?.input_tokens ?? null,
          outputTokens: compactedResponse.usage?.output_tokens ?? null,
          totalTokens: compactedResponse.usage?.total_tokens ?? null
        },
        usageBefore,
        usageAfter: compacted.usageAfter
      }
    },
    completionMetadata: {
      backend: "native",
      requestedBackend: input.requestedBackend,
      model: compactionModel,
      usageBefore,
      usageAfter: compacted.usageAfter,
      retainedItemCount: compacted.responseItems.length,
      compactionItemCount: compacted.compactionItemCount,
      encryptedContentLength,
      apiUsage: {
        inputTokens: compactedResponse.usage?.input_tokens ?? null,
        outputTokens: compactedResponse.usage?.output_tokens ?? null,
        totalTokens: compactedResponse.usage?.total_tokens ?? null
      }
    }
  };
}
