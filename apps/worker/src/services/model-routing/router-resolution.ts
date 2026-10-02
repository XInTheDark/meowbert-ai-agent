import type { PlatformModelRouter, PlatformModelRouterTarget, PlatformUsageBilling } from "@meowbert/shared";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { findPlatformModelRouterById } from "@meowbert/shared";
import type { TaskMessageRow } from "../agent/types.js";
import type { MemoryMainFile } from "../memory/index.js";
import type { WorkspaceImageDetail } from "../workspaces/workspace-model-settings.js";
import type { OpenAiProviderConfig } from "../agent/openai-client.js";
import { getOpenAiClient } from "../agent/openai-client.js";
import { platformUsageRecorder } from "../tasks/platform-usage.js";
import { deepMergeJsonObjects } from "../agent/utils.js";
import { buildTaskDecisionContext } from "../agent/task-decision-context.js";
import { query } from "../../lib/db.js";
import { extractObjectWithToolCall } from "../../lib/openai-tool-output.js";
import { emitTaskEvent } from "../runtime/events.js";

type RoutedReasoningEffort = "low" | "medium" | "high" | "xhigh";

interface RouterDecisionRow {
  requested_model: string;
  router_id: string;
  routing_model: string;
  resolved_model: string;
  reasoning_score: number;
  reason: string;
  used_fallback: boolean;
  quick_mode: boolean;
}

interface RouterToolResult {
  modelId: string;
  reasoningScore: number;
  reason: string;
  quickMode: boolean;
}

export interface ModelRouterResolution {
  requestedModel: string;
  resolvedModel: string;
  resolvedEnvironmentPayload: Record<string, unknown>;
  routingModel: string;
  reasoningScore: number;
  reasoningEffort: RoutedReasoningEffort;
  reason: string;
  usedFallback: boolean;
  cached: boolean;
  quickMode: boolean;
}

const ROUTER_TOOL_NAME = "select_runtime_model";
const ROUTER_TOOL_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    modelId: {
      type: "string"
    },
    reasoningScore: {
      type: "number"
    },
    reason: {
      type: "string"
    },
    quickMode: {
      type: "boolean"
    }
  },
  required: ["modelId", "reasoningScore", "reason", "quickMode"]
};
const ROUTER_REQUEST_MAX_ATTEMPTS = 2;
const ROUTER_REQUEST_BASE_DELAY_MS = 3_000;
const DEFAULT_ROUTER_REASONING_SCORE = 50;

function clampReasoningScore(score: number): number {
  if (!Number.isFinite(score)) {
    return DEFAULT_ROUTER_REASONING_SCORE;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function mapReasoningScoreToEffort(score: number): RoutedReasoningEffort {
  if (score >= 75) {
    return "xhigh";
  }
  if (score >= 50) {
    return "high";
  }
  if (score >= 25) {
    return "medium";
  }

  return "low";
}

function applyReasoningEffort(
  environmentPayload: Record<string, unknown>,
  reasoningEffort: RoutedReasoningEffort
): Record<string, unknown> {
  return deepMergeJsonObjects(environmentPayload, {
    responses: {
      reasoning: {
        effort: reasoningEffort
      }
    }
  });
}

function getTargetRuntimeModel(target: PlatformModelRouterTarget): string {
  const model = target.payload.model;
  return typeof model === "string" && model.trim().length > 0
    ? model.trim()
    : target.id;
}

function getDefaultRouterTarget(router: PlatformModelRouter): PlatformModelRouterTarget {
  return router.models.find((target) => target.id === router.defaultTargetModel) ?? router.models[0]!;
}

function getDecisionRouterTarget(
  router: PlatformModelRouter,
  targetId: string
): {
  target: PlatformModelRouterTarget;
  usedFallback: boolean;
} {
  const target = router.models.find((model) => model.id === targetId);
  if (target) {
    return {
      target,
      usedFallback: false
    };
  }

  return {
    target: getDefaultRouterTarget(router),
    usedFallback: true
  };
}

function findRouterTargetByStoredRuntimeModel(
  router: PlatformModelRouter,
  storedRuntimeModel: string
): PlatformModelRouterTarget | null {
  return router.models.find((target) => getTargetRuntimeModel(target) === storedRuntimeModel)
    ?? router.models.find((target) => target.id === storedRuntimeModel)
    ?? null;
}

function applyTargetPayload(
  environmentPayload: Record<string, unknown>,
  target: PlatformModelRouterTarget
): Record<string, unknown> {
  const targetPayload = { ...target.payload };
  delete targetPayload.model;

  return deepMergeJsonObjects(environmentPayload, targetPayload);
}

function applyTargetPayloadAndReasoning(input: {
  environmentPayload: Record<string, unknown>;
  target: PlatformModelRouterTarget;
  reasoningEffort: RoutedReasoningEffort;
}): Record<string, unknown> {
  return applyReasoningEffort(
    applyTargetPayload(input.environmentPayload, input.target),
    input.reasoningEffort
  );
}

function buildFallbackResolution(input: {
  requestedModel: string;
  router: PlatformModelRouter;
  environmentPayload: Record<string, unknown>;
  reason: string;
}): ModelRouterResolution {
  const reasoningScore = DEFAULT_ROUTER_REASONING_SCORE;
  const reasoningEffort = mapReasoningScoreToEffort(reasoningScore);
  const target = getDefaultRouterTarget(input.router);

  return {
    requestedModel: input.requestedModel,
    resolvedModel: getTargetRuntimeModel(target),
    resolvedEnvironmentPayload: applyTargetPayloadAndReasoning({
      environmentPayload: input.environmentPayload,
      target,
      reasoningEffort
    }),
    routingModel: input.router.routingModel,
    reasoningScore,
    reasoningEffort,
    reason: input.reason,
    usedFallback: true,
    cached: false,
    quickMode: false
  };
}

async function loadCachedResolution(
  branchMessageId: string,
  requestedModel: string,
  router: PlatformModelRouter,
  environmentPayload: Record<string, unknown>
): Promise<ModelRouterResolution | null> {
  const cached = await query<RouterDecisionRow>(
    `SELECT requested_model,
            router_id,
            routing_model,
            resolved_model,
            reasoning_score,
            reason,
            used_fallback,
            quick_mode
       FROM task_message_model_routes
      WHERE task_message_id = $1
        AND requested_model = $2`,
    [branchMessageId, requestedModel]
  );

  const row = cached.rows[0];
  if (!row) {
    return null;
  }

  const reasoningScore = clampReasoningScore(row.reasoning_score);
  const reasoningEffort = mapReasoningScoreToEffort(reasoningScore);
  const target = findRouterTargetByStoredRuntimeModel(router, row.resolved_model);
  return {
    requestedModel: row.requested_model,
    resolvedModel: row.resolved_model,
    resolvedEnvironmentPayload: target
      ? applyTargetPayloadAndReasoning({
        environmentPayload,
        target,
        reasoningEffort
      })
      : applyReasoningEffort(environmentPayload, reasoningEffort),
    routingModel: row.routing_model,
    reasoningScore,
    reasoningEffort,
    reason: row.reason,
    usedFallback: row.used_fallback === true,
    cached: true,
    quickMode: router.allowQuickMode === true && row.quick_mode === true
  };
}

async function persistResolution(input: {
  branchMessageId: string;
  resolution: ModelRouterResolution;
  routerId: string;
  router: PlatformModelRouter;
  environmentPayload: Record<string, unknown>;
}): Promise<{
  resolution: ModelRouterResolution;
  inserted: boolean;
}> {
  const inserted = await query<RouterDecisionRow>(
    `INSERT INTO task_message_model_routes (
       task_message_id,
       requested_model,
       router_id,
       routing_model,
       resolved_model,
       reasoning_score,
       reason,
       used_fallback,
       quick_mode
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (task_message_id, requested_model) DO NOTHING
     RETURNING requested_model,
               router_id,
               routing_model,
               resolved_model,
               reasoning_score,
               reason,
               used_fallback`,
    [
      input.branchMessageId,
      input.resolution.requestedModel,
      input.routerId,
      input.resolution.routingModel,
      input.resolution.resolvedModel,
      input.resolution.reasoningScore,
      input.resolution.reason,
      input.resolution.usedFallback,
      input.resolution.quickMode
    ]
  );

  if ((inserted.rowCount ?? 0) > 0) {
    return {
      resolution: {
        ...input.resolution,
        cached: false
      },
      inserted: true
    };
  }

  const cached = await loadCachedResolution(
    input.branchMessageId,
    input.resolution.requestedModel,
    input.router,
    input.environmentPayload
  );
  if (!cached) {
    return {
      resolution: {
        ...input.resolution,
        cached: false
      },
      inserted: false
    };
  }

  return {
    resolution: {
      ...cached,
      resolvedEnvironmentPayload: cached.resolvedEnvironmentPayload
    },
    inserted: false
  };
}

async function buildRoutingInput(input: {
  messages: TaskMessageRow[];
  router: PlatformModelRouter;
  taskInputDir?: string | null;
  memoryMainFile?: MemoryMainFile | null;
  projectMemoryMainFile?: MemoryMainFile | null;
  imageDetail?: WorkspaceImageDetail;
}): Promise<ResponseInputItem[]> {
  const decisionContext = await buildTaskDecisionContext({
    messages: input.messages,
    taskInputDir: input.taskInputDir,
    memoryMainFile: input.memoryMainFile,
    projectMemoryMainFile: input.projectMemoryMainFile,
    imageDetail: input.imageDetail,
    mode: "recent"
  });

  return [
    {
      role: "developer",
      content: [
        "Choose the best runtime model for the next assistant turn.",
        "Return only a modelId from the provided targetModels.",
        "Return reasoningScore as a number from 0 to 100.",
        "Higher reasoningScore means the runtime should use more reasoning effort.",
        "Use lower scores for simple, quick, or low-risk requests.",
        "Use higher scores for complex, ambiguous, multi-step, or correctness-sensitive requests.",
        input.router.allowQuickMode
          ? "You may set quickMode true for simple chat, explanation, drafting, or direct-answer requests that do not need tools, file access, shell commands, project context, or sandbox setup. Use quickMode false when the assistant may need to inspect files, run commands, use tools, or modify anything."
          : "Set quickMode false."
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify({
        targetModels: input.router.models.map((target) => ({
          id: target.id,
          description: target.description
        })),
        allowQuickMode: input.router.allowQuickMode,
        decisionContext: decisionContext.text
      })
    },
    ...decisionContext.imageItems
  ];
}

async function emitModelRoutedEvent(taskId: string, resolution: ModelRouterResolution): Promise<void> {
  await emitTaskEvent(taskId, "model_routed", {
    requestedModel: resolution.requestedModel,
    resolvedModel: resolution.resolvedModel,
    routingModel: resolution.routingModel,
    reasoningScore: resolution.reasoningScore,
    reasoningEffort: resolution.reasoningEffort,
    reason: resolution.reason,
    usedFallback: resolution.usedFallback,
    quickMode: resolution.quickMode,
    cached: resolution.cached
  });
}

function normalizeRoutingDecision(
  decision: RouterToolResult | null,
  router: PlatformModelRouter,
  requestedModel: string,
  environmentPayload: Record<string, unknown>
): ModelRouterResolution {
  if (!decision) {
    return buildFallbackResolution({
      requestedModel,
      router,
      environmentPayload,
      reason: "Router returned no valid decision."
    });
  }

  const { target, usedFallback } = getDecisionRouterTarget(router, decision.modelId);
  const reasoningScore = clampReasoningScore(decision.reasoningScore);
  const reasoningEffort = mapReasoningScoreToEffort(reasoningScore);
  const reason = typeof decision.reason === "string" && decision.reason.trim().length > 0
    ? decision.reason.trim()
    : "Router returned no reason.";

  return {
    requestedModel,
    resolvedModel: getTargetRuntimeModel(target),
    resolvedEnvironmentPayload: applyTargetPayloadAndReasoning({
      environmentPayload,
      target,
      reasoningEffort
    }),
    routingModel: router.routingModel,
    reasoningScore,
    reasoningEffort,
    reason: usedFallback ? `Invalid model returned by router. ${reason}` : reason,
    usedFallback,
    cached: false,
    quickMode: router.allowQuickMode === true && decision.quickMode === true
  };
}

export async function resolveModelRouterSelection(input: {
  taskId: string;
  billing: PlatformUsageBilling | null;
  requestedModel: string;
  environmentPayload: Record<string, unknown>;
  platformModelRouters: PlatformModelRouter[];
  provider: OpenAiProviderConfig;
  branchMessageId: string | null;
  messages: TaskMessageRow[];
  taskInputDir?: string | null;
  memoryMainFile?: MemoryMainFile | null;
  projectMemoryMainFile?: MemoryMainFile | null;
  imageDetail?: WorkspaceImageDetail;
  requestTimeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<ModelRouterResolution | null> {
  const router = findPlatformModelRouterById(input.platformModelRouters, input.requestedModel);
  if (!router) {
    return null;
  }

  const requestedModel = router.id;
  const cached = input.branchMessageId
    ? await loadCachedResolution(input.branchMessageId, requestedModel, router, input.environmentPayload)
    : null;
  if (cached) {
    return cached;
  }

  const client = getOpenAiClient(input.provider);
  let resolution: ModelRouterResolution;
  try {
    const extraction = await extractObjectWithToolCall<RouterToolResult>({
      client,
      model: router.routingModel,
      toolName: ROUTER_TOOL_NAME,
      toolDescription: "Select the best runtime model and reasoning score for the next assistant run.",
      schema: ROUTER_TOOL_SCHEMA,
      input: await buildRoutingInput({
        messages: input.messages,
        router,
        taskInputDir: input.taskInputDir,
        memoryMainFile: input.memoryMainFile,
        projectMemoryMainFile: input.projectMemoryMainFile,
        imageDetail: input.imageDetail
      }),
      requestTimeoutMs: Math.max(1_000, Math.min(input.requestTimeoutMs, 60_000)),
      abortSignal: input.abortSignal,
      maxAttempts: ROUTER_REQUEST_MAX_ATTEMPTS,
      baseRetryDelayMs: ROUTER_REQUEST_BASE_DELAY_MS,
      onResponseUsage: (usage) => platformUsageRecorder.recordResponseUsage(input.billing, router.routingModel, usage)
    });

    resolution = extraction.ok
      ? normalizeRoutingDecision(extraction.value, router, requestedModel, input.environmentPayload)
      : buildFallbackResolution({
        requestedModel,
        router,
        environmentPayload: input.environmentPayload,
        reason: `Router failed: ${extraction.error}`
      });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "TASK_CANCELLED") {
      throw error;
    }

    resolution = buildFallbackResolution({
      requestedModel,
      router,
      environmentPayload: input.environmentPayload,
      reason: `Router failed: ${message}`
    });
  }

  if (input.branchMessageId) {
    const persisted = await persistResolution({
      branchMessageId: input.branchMessageId,
      resolution,
      routerId: router.id,
      router,
      environmentPayload: input.environmentPayload
    });
    const nextResolution = persisted.resolution;
    if (persisted.inserted) {
      await emitModelRoutedEvent(input.taskId, nextResolution);
    }
    return nextResolution;
  }

  await emitModelRoutedEvent(input.taskId, resolution);
  return resolution;
}
