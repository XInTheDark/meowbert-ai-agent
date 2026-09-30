import { z } from "zod";
import {
  AGENT_SWARM_MAX_WORKERS,
  AGENT_SWARM_MIN_WORKERS,
  normalizeAgentSwarmAgentAllocations,
  sumAgentSwarmAgentAllocations,
  isSkillEnabledByConfig,
  type TaskSource
} from "@meowbert/shared";
import { AGENT_SWARM_MAX_REVIEW_ROUNDS } from "@meowbert/shared/agent-swarm";
import { config } from "../../lib/config.js";
import { query, withTransaction } from "../../lib/db.js";
import { getPromptEntitlementStatus } from "../../services/billing/entitlements.js";
import {
  recordRecurringRunPromptUsageIfRequired,
  resolveRecurringRunPromptEntitlement
} from "../../services/tasks/recurring-run-entitlement.js";
import { enqueueRun } from "../../services/tasks/task-service/index.js";

export const environmentParams = z.object({ envId: z.string().uuid() });
export const taskParams = z.object({ taskId: z.string().uuid() });
export const taskChannelParams = z.object({ taskId: z.string().uuid(), channelId: z.string().uuid() });
export const taskMessageParams = z.object({ taskId: z.string().uuid(), messageId: z.string().uuid() });
export const publicTaskShareParams = z.object({ shareId: z.string().uuid() });

export const taskDetailQuery = z.object({
  messageDetail: z.enum(["full", "metadata", "none"]).default("full")
});

export const taskConversationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  beforeIndex: z.coerce.number().int().min(0).optional(),
  afterIndex: z.coerce.number().int().min(0).optional(),
  activeLeafMessageId: z.string().uuid().optional(),
  targetMessageId: z.string().uuid().optional()
}).refine((value) => !(value.beforeIndex !== undefined && value.afterIndex !== undefined), {
  message: "beforeIndex and afterIndex are mutually exclusive"
});

export const taskConversationSearchQuery = z.object({
  q: z.string().min(1).max(500),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  activeLeafMessageId: z.string().uuid().optional()
});

export const taskMessageContentBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200)
});

export const taskEventsPageQuery = z.object({
  direction: z.enum(["older", "newer"]).default("older"),
  limit: z.coerce.number().int().min(1).max(300).default(120),
  cursorCreatedAt: z.string().datetime().optional(),
  cursorId: z.string().uuid().optional()
});

export const taskEventsStreamQuery = z.object({
  replayLimit: z.coerce.number().int().min(0).max(2_000).default(200)
});

export interface RecurringToolOptions {
  webSearch?: boolean;
  memorySearch?: boolean;
  scheduleTask?: boolean;
  subtasks?: boolean;
  computerUse?: boolean;
  interactiveCanvas?: boolean;
  enabledSkills?: string[];
  enabledSources?: string[];
}

export const taskToolOptionsSchema = z
  .object({
    webSearch: z.boolean().optional(),
    memorySearch: z.boolean().optional(),
    scheduleTask: z.boolean().optional(),
    subtasks: z.boolean().optional(),
    computerUse: z.boolean().optional(),
    interactiveCanvas: z.boolean().optional(),
    enabledSkills: z.array(z.string()).optional(),
    enabledSources: z.array(z.string()).optional()
  })
  .strict()
  .optional();

export const taskAgentSelectionSchema = z
  .object({
    id: z.string().min(1).max(240)
  })
  .strict()
  .optional();

export const taskAttachmentSchema = z
  .object({
    id: z.string().min(1).max(240).optional(),
    kind: z.enum(["note", "file", "directory", "canvas"]),
    label: z.string().min(1).max(500),
    content: z.string().min(1),
    relativePath: z.string().min(1).optional(),
    sizeBytes: z.number().finite().nullable().optional(),
    forceInclude: z.boolean().optional()
  })
  .strict();

export const taskAttachmentsSchema = z.array(taskAttachmentSchema).max(50).optional();

export const taskTrashBody = z.object({ trashed: z.boolean().default(true) });
export const taskForkBody = z.object({
  title: z.string().min(1).max(240).optional(),
  messageId: z.string().uuid().optional(),
  copyTaskFiles: z.boolean().optional()
});
export const publicTaskForkBody = taskForkBody.extend({
  environmentId: z.string().uuid()
});
export const taskBranchSelectionBody = z.object({ activeLeafMessageId: z.string().uuid() });
export const taskCommandInterruptBody = z.object({ step: z.number().int().min(0) });
export const taskThreadsQuery = z.object({
  parentMessageId: z.string().uuid()
});
export const createTaskThreadBody = z.object({
  taskId: z.string().uuid().optional(),
  messageId: z.string().uuid(),
  message: z.string().min(1),
  interactiveCanvasId: z.string().uuid().nullable().optional(),
  interactiveCanvasIntent: z.enum(["create", "update", "view"]).optional(),
  attachments: taskAttachmentsSchema,
  selectedText: z.string().min(1).optional(),
  selectedTextLocation: z.string().min(1).optional(),
  tools: taskToolOptionsSchema,
  agent: taskAgentSelectionSchema
});

export const taskScheduleCreateSchema = z
  .object({
    type: z.enum(["scheduled", "infinite", "timed"]),
    repeat: z.string().min(1).max(120).nullable().optional(),
    timezone: z.string().min(1).max(120).nullable().optional(),
    timeLimitSeconds: z.number().int().min(60).max(7 * 24 * 60 * 60).nullable().optional()
  })
  .strict()
  .optional();

export const taskSchedulePatchSchema = z
  .object({
    type: z.enum(["standard", "scheduled", "infinite", "timed"]),
    repeat: z.string().min(1).max(120).nullable().optional(),
    timezone: z.string().min(1).max(120).nullable().optional(),
    timeLimitSeconds: z.number().int().min(60).max(7 * 24 * 60 * 60).nullable().optional()
  })
  .strict()
  .optional();

export const taskParametersSchema = z
  .object({
    maxSteps: z.number().int().positive().nullable().optional(),
    timeLimitSeconds: z.number().int().min(60).max(7 * 24 * 60 * 60).nullable().optional(),
    allowWaiting: z.boolean().optional()
  })
  .strict()
  .optional();

export const taskWorkflowCreateSchema = z
  .object({
    type: z.enum(["long_horizon", "deep_research", "quality_control", "agent_swarm"]),
    workerCount: z.number().int().min(AGENT_SWARM_MIN_WORKERS).max(AGENT_SWARM_MAX_WORKERS).nullable().optional(),
    reviewRounds: z.number().int().min(0).max(AGENT_SWARM_MAX_REVIEW_ROUNDS).nullable().optional(),
    leaderAgentId: z.string().min(1).max(240).nullable().optional(),
    modelAllocations: z.array(z.object({
      agentId: z.string().min(1).max(240),
      workerCount: z.number().int().min(1).max(AGENT_SWARM_MAX_WORKERS)
    }).strict()).max(20).nullable().optional(),
    tokenBudget: z.number().int().positive().max(100_000_000).nullable().optional(),
    timeBudgetMinutes: z.number().int().positive().max(10_080).nullable().optional(),
    disableSpawningAndBudgets: z.boolean().optional(),
    enableClarifyPhase: z.boolean().optional(),
    enableReviewPhase: z.boolean().optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type !== "agent_swarm" || !Array.isArray(value.modelAllocations) || value.modelAllocations.length === 0) {
      return;
    }

    const workerCount = sumAgentSwarmAgentAllocations(normalizeAgentSwarmAgentAllocations(value.modelAllocations));
    if (workerCount < AGENT_SWARM_MIN_WORKERS || workerCount > AGENT_SWARM_MAX_WORKERS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modelAllocations"],
        message: `Agent Swarm allocations must assign ${AGENT_SWARM_MIN_WORKERS} to ${AGENT_SWARM_MAX_WORKERS} workers.`
      });
    }
  })
  .optional();

export const taskWorkflowPatchSchema = z
  .object({
    type: z.enum(["standard", "long_horizon", "deep_research", "quality_control", "agent_swarm"]),
    workerCount: z.number().int().min(AGENT_SWARM_MIN_WORKERS).max(AGENT_SWARM_MAX_WORKERS).nullable().optional(),
    reviewRounds: z.number().int().min(0).max(AGENT_SWARM_MAX_REVIEW_ROUNDS).nullable().optional(),
    leaderAgentId: z.string().min(1).max(240).nullable().optional(),
    modelAllocations: z.array(z.object({
      agentId: z.string().min(1).max(240),
      workerCount: z.number().int().min(1).max(AGENT_SWARM_MAX_WORKERS)
    }).strict()).max(20).nullable().optional(),
    tokenBudget: z.number().int().positive().max(100_000_000).nullable().optional(),
    timeBudgetMinutes: z.number().int().positive().max(10_080).nullable().optional(),
    disableSpawningAndBudgets: z.boolean().optional(),
    enableClarifyPhase: z.boolean().optional(),
    enableReviewPhase: z.boolean().optional()
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.type === "agent_swarm" && value.timeBudgetMinutes != null && value.tokenBudget == null
      && value.disableSpawningAndBudgets !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["tokenBudget"],
        message: "An Agent Swarm time budget requires a token budget."
      });
    }
    if (value.type !== "agent_swarm" || !Array.isArray(value.modelAllocations) || value.modelAllocations.length === 0) {
      return;
    }

    const workerCount = sumAgentSwarmAgentAllocations(normalizeAgentSwarmAgentAllocations(value.modelAllocations));
    if (workerCount < AGENT_SWARM_MIN_WORKERS || workerCount > AGENT_SWARM_MAX_WORKERS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["modelAllocations"],
        message: `Agent Swarm allocations must assign ${AGENT_SWARM_MIN_WORKERS} to ${AGENT_SWARM_MAX_WORKERS} workers.`
      });
    }
  })
  .optional();

export const taskParametersPatchBody = z
  .object({
    maxSteps: z.number().int().positive().nullable().optional(),
    timeLimitSeconds: z.number().int().min(60).max(7 * 24 * 60 * 60).nullable().optional(),
    schedule: taskSchedulePatchSchema,
    workflow: taskWorkflowPatchSchema,
    tools: taskToolOptionsSchema,
    allowWaiting: z.boolean().optional()
  })
  .strict();

export const createTaskBodySchema = z.object({
  taskId: z.string().uuid().optional(),
  title: z.string().max(240).optional(),
  message: z.string().min(1),
  quickMode: z.boolean().optional(),
  incognito: z.boolean().optional(),
  interactiveCanvasId: z.string().uuid().nullable().optional(),
  interactiveCanvasIntent: z.enum(["create", "update", "view"]).optional(),
  attachments: taskAttachmentsSchema,
  clientTimezone: z.string().min(1).max(120).optional(),
  tools: taskToolOptionsSchema,
  agent: taskAgentSelectionSchema,
  schedule: taskScheduleCreateSchema,
  parameters: taskParametersSchema,
  workflow: taskWorkflowCreateSchema
});

export const postTaskMessageBody = z.object({
  message: z.string().min(1),
  interactiveCanvasId: z.string().uuid().nullable().optional(),
  interactiveCanvasIntent: z.enum(["create", "update", "view"]).optional(),
  attachments: taskAttachmentsSchema,
  tools: taskToolOptionsSchema,
  agent: taskAgentSelectionSchema
});

export const patchTaskBody = z.object({
  title: z.string().max(240).nullable().optional(),
  folderId: z.string().uuid().nullable().optional(),
  folderSortOrder: z.number().finite().optional()
}).strict();

export const editTaskMessageBody = z
  .object({
    message: z.string().min(1).optional(),
    content: z.string().min(1).optional(),
    interactiveCanvasId: z.string().uuid().nullable().optional(),
    interactiveCanvasIntent: z.enum(["create", "update", "view"]).optional(),
    attachments: taskAttachmentsSchema,
    tools: taskToolOptionsSchema,
    agent: taskAgentSelectionSchema
  })
  .refine((value) => typeof value.message === "string" || typeof value.content === "string", {
    message: "message is required"
  });

export const CONTINUE_TASK_PROMPT = "Continue.";
const DEFAULT_MAX_ACTIVE_RECURRING_TASKS_PER_ENV = 10;
const DEFAULT_MAX_ACTIVE_RECURRING_TASKS_PER_WORKSPACE = 50;

export interface TaskScheduleResponseFields {
  schedule_mode: "scheduled" | "infinite" | null;
  schedule_state: "active" | "paused" | "cancelled" | null;
  schedule_repeat_cron: string | null;
  schedule_timezone: string | null;
  schedule_next_run_at: string | null;
  schedule_pending_run: boolean | null;
  schedule_run_timeout_seconds: number | null;
  schedule_run_deadline_at: string | null;
}

export function normalizeTriggerSource(rawSource: string): TaskSource {
  if (rawSource === "telegram" || rawSource === "discord" || rawSource === "github" || rawSource === "email") {
    return rawSource;
  }

  return "web";
}

export function normalizeRecurringToolOptions(rawValue: unknown): RecurringToolOptions | undefined {
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
    return undefined;
  }

  const raw = rawValue as Record<string, unknown>;
  const normalized: RecurringToolOptions = {};

  if (raw.webSearch === true) normalized.webSearch = true;
  if (raw.memorySearch === true) normalized.memorySearch = true;
  if (raw.scheduleTask === true) normalized.scheduleTask = true;
  if (raw.subtasks === true) normalized.subtasks = true;
  if (raw.computerUse === true) normalized.computerUse = true;
  if (raw.interactiveCanvas === true) normalized.interactiveCanvas = true;

  if (Array.isArray(raw.enabledSkills)) {
    const enabledSkills = raw.enabledSkills
      .filter((skill): skill is string => typeof skill === "string")
      .map((skill) => skill.trim())
      .filter((skill) => skill.length > 0)
      .filter((skill) => isSkillEnabledByConfig(config, skill));
    if (enabledSkills.length > 0) {
      normalized.enabledSkills = Array.from(new Set(enabledSkills));
    }
  }

  if (Array.isArray(raw.enabledSources)) {
    const enabledSources = raw.enabledSources
      .filter((source): source is string => typeof source === "string")
      .map((source) => source.trim())
      .filter((source) => source.length > 0);
    if (enabledSources.length > 0) {
      normalized.enabledSources = Array.from(new Set(enabledSources));
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export async function assertRecurringTaskLimits(workspaceId: string, environmentId: string): Promise<void> {
  const maxPerEnvironment = config.limits.maxActiveRecurringTasksPerEnv ?? DEFAULT_MAX_ACTIVE_RECURRING_TASKS_PER_ENV;
  const maxPerWorkspace =
    config.limits.maxActiveRecurringTasksWorkspace ?? DEFAULT_MAX_ACTIVE_RECURRING_TASKS_PER_WORKSPACE;

  const [envCountRes, wsCountRes] = await Promise.all([
    query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM task_schedules ts
         JOIN tasks t ON t.id = ts.task_id
        WHERE ts.schedule_state = 'active'
          AND t.environment_id = $1
          AND t.trashed_at IS NULL`,
      [environmentId]
    ),
    query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
         FROM task_schedules ts
         JOIN tasks t ON t.id = ts.task_id
        WHERE ts.schedule_state = 'active'
          AND t.workspace_id = $1
          AND t.trashed_at IS NULL`,
      [workspaceId]
    )
  ]);

  const activeInEnvironment = envCountRes.rows[0]?.count ?? 0;
  const activeInWorkspace = wsCountRes.rows[0]?.count ?? 0;

  if (activeInEnvironment >= maxPerEnvironment) {
    throw new Error(`Active recurring task limit reached for environment (${maxPerEnvironment})`);
  }
  if (activeInWorkspace >= maxPerWorkspace) {
    throw new Error(`Active recurring task limit reached for workspace (${maxPerWorkspace})`);
  }
}

export function uniqueIdsPreserveOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

export function buildEntitlementExceededPayload(
  status: Awaited<ReturnType<typeof getPromptEntitlementStatus>>
): Record<string, unknown> {
  if (status.mode === "subscription") {
    return {
      error: status.reason ?? "Subscription usage limit reached.",
      mode: status.mode,
      limit: status.monthlyWeightedTokenLimit,
      used: status.monthlyWeightedTokenUsed,
      subscriptionUsageLimitExceeded: status.subscriptionUsageLimitExceeded
    };
  }

  return {
    error: status.reason ?? "Lifetime free message quota exceeded.",
    mode: status.mode,
    limit: status.freeMessageLimit,
    used: status.freeMessagesUsed
  };
}

async function decideRecurringRunNow(input: {
  taskId: string;
  forceActivate?: boolean;
}): Promise<
  | {
      mode: "ready";
      taskSource: TaskSource;
      runMode: "scheduled_auto" | "infinite_auto";
      toolOptionsOverride: RecurringToolOptions | undefined;
    }
  | {
      mode: "pending";
    }
> {
  return withTransaction(async (client) => {
    const taskRes = await client.query<{ status: string; source: string }>(
      `SELECT status, source
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [input.taskId]
    );
    if ((taskRes.rowCount ?? 0) === 0) {
      throw new Error("Task not found");
    }

    const scheduleRes = await client.query<{
      mode: "scheduled" | "infinite";
      schedule_state: "active" | "paused" | "cancelled";
      enabled_tools_json: unknown;
      run_timeout_seconds: number | null;
    }>(
      `SELECT mode, schedule_state, enabled_tools_json, run_timeout_seconds
         FROM task_schedules
        WHERE task_id = $1
        FOR UPDATE`,
      [input.taskId]
    );
    if ((scheduleRes.rowCount ?? 0) === 0) {
      throw new Error("Task is not scheduled");
    }

    const schedule = scheduleRes.rows[0];
    const shouldActivate = input.forceActivate === true;
    if (!shouldActivate && schedule.schedule_state !== "active") {
      throw new Error("Task schedule is paused");
    }

    await client.query(
      `UPDATE task_schedules
          SET schedule_state = CASE WHEN $2 THEN 'active' ELSE schedule_state END,
              cancelled_at = CASE WHEN $2 THEN NULL ELSE cancelled_at END,
              run_deadline_at = CASE
                WHEN $2
                  AND mode = 'infinite'
                  AND run_timeout_seconds IS NOT NULL
                THEN now() + make_interval(secs => run_timeout_seconds)
                ELSE run_deadline_at
              END,
              pending_run = $3,
              updated_at = now()
        WHERE task_id = $1`,
      [
        input.taskId,
        shouldActivate,
        taskRes.rows[0].status === "running"
          || taskRes.rows[0].status === "starting"
          || taskRes.rows[0].status === "queued"
      ]
    );

    if (
      taskRes.rows[0].status === "running"
      || taskRes.rows[0].status === "starting"
      || taskRes.rows[0].status === "queued"
    ) {
      return { mode: "pending" as const };
    }

    return {
      mode: "ready" as const,
      taskSource: normalizeTriggerSource(taskRes.rows[0].source),
      runMode: schedule.mode === "scheduled" ? "scheduled_auto" as const : "infinite_auto" as const,
      toolOptionsOverride: normalizeRecurringToolOptions(schedule.enabled_tools_json)
    };
  });
}

export async function enqueueRecurringRunNow(input: {
  taskId: string;
  workspaceId: string;
  environmentId: string;
  selectionUserId?: string;
  forceActivate?: boolean;
}): Promise<
  | {
      mode: "enqueued";
      runId: string;
      attemptNo: number;
    }
  | {
      mode: "pending";
    }
> {
  const promptEntitlement = await resolveRecurringRunPromptEntitlement(input.taskId);
  const decision = await decideRecurringRunNow(input);
  if (decision.mode !== "ready") {
    return decision;
  }

  const run = await enqueueRun({
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    triggerSource: decision.taskSource,
    mode: decision.runMode,
    toolOptionsOverride: decision.toolOptionsOverride,
    selectionUserId: input.selectionUserId,
    priorityActorUserId: input.selectionUserId,
    dispatchCategory: "followup"
  });
  await recordRecurringRunPromptUsageIfRequired({
    taskId: input.taskId,
    accountableUserId: promptEntitlement.accountableUserId,
    entitlement: promptEntitlement.entitlement
  });

  return {
    mode: "enqueued",
    runId: run.runId,
    attemptNo: run.attemptNo
  };
}

export function buildTaskScheduleResponse(input: TaskScheduleResponseFields) {
  if (!input.schedule_mode) {
    return null;
  }

  return {
    mode: input.schedule_mode,
    state: input.schedule_state,
    repeat: input.schedule_repeat_cron,
    timezone: input.schedule_timezone,
    next_run_at: input.schedule_next_run_at,
    pending_run: input.schedule_pending_run === true,
    run_timeout_seconds: input.schedule_run_timeout_seconds,
    run_deadline_at: input.schedule_run_deadline_at
  };
}
