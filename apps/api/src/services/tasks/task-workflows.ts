import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  createTaskMessageMetadata,
  type TaskWorkflowType
} from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import {
  buildUserMessageContent,
  normalizeTaskMessageToolOptions,
  setTaskBranchSelection,
  type TaskMessageAttachment,
  type TaskMessageAgentSelection,
  type TaskMessageSender,
  type TaskMessageToolOptions
} from "./task-service/index.js";
import { ensureDispatchedRun } from "./task-service/runs.js";
import type { ProjectCanvasIntent } from "../canvases/project-canvases.js";
import { activateTaskTimeLimitInTx } from "./task-service/time-limit.js";

type WorkflowPhase =
  | "clarify"
  | "working"
  | "approved"
  | "completed";

export interface BaseCreateWorkflowInput {
  taskId?: string;
  workspaceId: string;
  environmentId: string;
  initiatorUserId: string;
  title?: string;
  message: string;
  attachments?: TaskMessageAttachment[];
  defaultTimezone: string;
  tools?: TaskMessageToolOptions;
  agent?: TaskMessageAgentSelection;
  sender?: TaskMessageSender;
  maxStepsOverride?: number | null;
  allowWaiting?: boolean | null;
  timeLimitSeconds?: number | null;
  interactiveCanvasId?: string | null;
  interactiveCanvasIntent?: ProjectCanvasIntent | null;
}

type LongHorizonWorkflowInput = BaseCreateWorkflowInput & {
  tokenBudget?: number | null;
  timeBudgetMinutes?: number | null;
  enableClarifyPhase?: boolean;
  enableReviewPhase?: boolean;
  reviewMode?: "standard" | "quality_control";
  researchMode?: "standard" | "deep_research";
};

const LONG_HORIZON_REVIEWER_COUNT = 1;

interface ExistingWorkflowTaskCreateMatch {
  taskId: string;
  userMessageId: string;
}

function buildTaskRootPath(taskId: string): string {
  return `.meowbert/task-runs/${taskId}`;
}

export function isTaskPrimaryKeyConflict(error: unknown): boolean {
  return (error as { code?: string }).code === "23505"
    && (error as { constraint?: string }).constraint === "tasks_pkey";
}

async function findExistingWorkflowTask(
  taskId: string,
  input: BaseCreateWorkflowInput,
  workflowType: "long_horizon"
): Promise<ExistingWorkflowTaskCreateMatch | null> {
  const existingRes = await query<{
    task_id: string;
    user_message_id: string | null;
  }>(
    `SELECT t.id AS task_id,
            initial_user.id AS user_message_id
       FROM tasks t
       JOIN task_workflows w
         ON w.task_id = t.id
        AND w.workflow_type = $5
       LEFT JOIN LATERAL (
         SELECT tm.id
           FROM task_messages tm
          WHERE tm.task_id = t.id
            AND tm.role = 'user'
          ORDER BY tm.created_at ASC, tm.id ASC
          LIMIT 1
       ) AS initial_user ON true
      WHERE t.id = $1
        AND t.workspace_id = $2
        AND t.environment_id = $3
        AND t.source = 'web'
        AND t.initiator_user_id = $4
      LIMIT 1`,
    [taskId, input.workspaceId, input.environmentId, input.initiatorUserId, workflowType]
  );
  const existing = existingRes.rows[0];
  if (!existing?.user_message_id) {
    return null;
  }

  return {
    taskId: existing.task_id,
    userMessageId: existing.user_message_id
  };
}

export async function ensureWorkflowInitialRun(input: {
  taskId: string;
  userMessageId: string;
  workspaceId: string;
  environmentId: string;
  initiatorUserId: string;
  mode: "long_horizon_clarify" | "long_horizon_main" | "agent_swarm_leader";
  toolOptionsOverride?: TaskMessageToolOptions;
}): Promise<{ runId: string }> {
  const run = await ensureDispatchedRun({
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    triggerSource: "web",
    mode: input.mode,
    branchMessageId: input.userMessageId,
    selectionUserId: input.initiatorUserId,
    priorityActorUserId: input.initiatorUserId,
    dispatchCategory: "new",
    toolOptionsOverride: input.toolOptionsOverride
      ? normalizeTaskMessageToolOptions(input.toolOptionsOverride)
      : undefined
  });
  return { runId: run.runId };
}

async function reuseExistingWorkflowTask(input: {
  existing: ExistingWorkflowTaskCreateMatch;
  workspaceId: string;
  environmentId: string;
  initiatorUserId: string;
  mode: "long_horizon_clarify" | "long_horizon_main" | "agent_swarm_leader";
  toolOptionsOverride?: TaskMessageToolOptions;
}): Promise<{ taskId: string; runId: string; userMessageId: string; reusedExisting: true }> {
  const run = await ensureWorkflowInitialRun({
    taskId: input.existing.taskId,
    userMessageId: input.existing.userMessageId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    initiatorUserId: input.initiatorUserId,
    mode: input.mode,
    toolOptionsOverride: input.toolOptionsOverride
  });
  return {
    taskId: input.existing.taskId,
    runId: run.runId,
    userMessageId: input.existing.userMessageId,
    reusedExisting: true
  };
}

export async function insertTaskWithInitialUserMessage(
  client: PoolClient,
  input: {
    taskId: string;
    workspaceId: string;
    environmentId: string;
    initiatorUserId: string;
    title?: string;
    message: string;
    attachments?: TaskMessageAttachment[];
    defaultTimezone: string;
    tools?: TaskMessageToolOptions;
    agent?: TaskMessageAgentSelection;
    sender?: TaskMessageSender;
    maxStepsOverride?: number | null;
    allowWaiting?: boolean | null;
    timeLimitSeconds?: number | null;
    workflowType?: TaskWorkflowType | null;
    workflowParentTaskId?: string | null;
    workflowInternalRole?: "reviewer" | null;
    interactiveCanvasId?: string | null;
    interactiveCanvasIntent?: ProjectCanvasIntent | null;
  }
): Promise<{ userMessageId: string; userMessageCreatedAt: string }> {
  const createdAt = new Date().toISOString();
  await client.query(
    `INSERT INTO tasks (
      id,
      workspace_id,
      environment_id,
      title,
      status,
      source,
      initiator_user_id,
      default_timezone,
      max_steps_override,
      allow_waiting,
      time_limit_seconds,
      task_root_path,
      workflow_type,
      workflow_parent_task_id,
      workflow_internal_role,
      interactive_canvas_id,
      interactive_canvas_intent
    ) VALUES ($1, $2, $3, $4, 'queued', 'web', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      input.taskId,
      input.workspaceId,
      input.environmentId,
      input.title ?? null,
      input.initiatorUserId,
      input.defaultTimezone,
      input.maxStepsOverride ?? null,
      input.allowWaiting ?? true,
      input.timeLimitSeconds ?? null,
      buildTaskRootPath(input.taskId),
      input.workflowType ?? null,
      input.workflowParentTaskId ?? null,
      input.workflowInternalRole ?? null,
      input.interactiveCanvasId ?? null,
      input.interactiveCanvasIntent ?? null
    ]
  );

  const insertedUser = await client.query<{ id: string; created_at: string }>(
    `INSERT INTO task_messages (
      task_id,
      role,
      content_json,
      message_metadata_json,
      author_user_id,
      created_at
    )
    VALUES ($1, 'user', $2::jsonb, $3::jsonb, $4, $5)
    RETURNING id, created_at`,
    [
      input.taskId,
      JSON.stringify(
        buildUserMessageContent({
          message: input.message,
          sender: input.sender,
          attachments: input.attachments,
          tools: input.tools,
          agent: input.agent
        })
      ),
      JSON.stringify(createTaskMessageMetadata(createdAt)),
      input.initiatorUserId,
      createdAt
    ]
  );

  return {
    userMessageId: insertedUser.rows[0].id,
    userMessageCreatedAt: insertedUser.rows[0].created_at
  };
}

async function insertWorkflowRow(
  client: PoolClient,
  input: {
    taskId: string;
    workflowType: TaskWorkflowType;
    phase: WorkflowPhase;
    config: Record<string, unknown>;
    state?: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO task_workflows (
      task_id,
      workflow_type,
      phase,
      config_json,
      state_json
    )
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [
      input.taskId,
      input.workflowType,
      input.phase,
      JSON.stringify(input.config),
      JSON.stringify(input.state ?? {})
    ]
  );
}

async function insertWorkflowAgent(
  client: PoolClient,
  input: {
    workflowTaskId: string;
    role: "main" | "reviewer";
    slotIndex: number;
    taskId: string;
    state?: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO task_workflow_agents (
      workflow_task_id,
      role,
      slot_index,
      task_id,
      state_json
    )
    VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING id`,
    [input.workflowTaskId, input.role, input.slotIndex, input.taskId, JSON.stringify(input.state ?? {})]
  );

  return { id: result.rows[0].id };
}

async function createLongHorizonWorkflowRecords(
  input: LongHorizonWorkflowInput,
  taskId: string,
  reviewerTaskIds: string[],
  reviewerCount: number,
  workflowTitle: string,
  enableClarifyPhase: boolean
): Promise<{ userMessageId: string; userMessageCreatedAt: string }> {
  return withTransaction(async (client) => {
    const parent = await insertTaskWithInitialUserMessage(client, {
      taskId,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      initiatorUserId: input.initiatorUserId,
      title: input.title,
      message: input.message,
      attachments: input.attachments,
      defaultTimezone: input.defaultTimezone,
      tools: input.tools,
      agent: input.agent,
      maxStepsOverride: input.maxStepsOverride,
      allowWaiting: input.allowWaiting,
      timeLimitSeconds: input.timeLimitSeconds,
      workflowType: "long_horizon",
      interactiveCanvasId: input.interactiveCanvasId,
      interactiveCanvasIntent: input.interactiveCanvasIntent
    });

    await setTaskBranchSelection({
      taskId,
      userId: input.initiatorUserId,
      activeLeafMessageId: parent.userMessageId,
      client
    });

    await insertWorkflowRow(client, {
      taskId,
      workflowType: "long_horizon",
      phase: enableClarifyPhase ? "clarify" : "working",
      config: {
        reviewerCount,
        tokenBudget: input.tokenBudget ?? null,
        timeBudgetMinutes: input.timeBudgetMinutes ?? null,
        enableClarifyPhase,
        enableReviewPhase: input.enableReviewPhase !== false,
        reviewMode: input.reviewMode ?? "standard",
        researchMode: input.researchMode ?? "standard"
      }
    });

    await insertWorkflowAgent(client, {
      workflowTaskId: taskId,
      role: "main",
      slotIndex: 0,
      taskId
    });

    for (let index = 0; index < reviewerTaskIds.length; index += 1) {
      const reviewerTaskId = reviewerTaskIds[index];
      await insertTaskWithInitialUserMessage(client, {
        taskId: reviewerTaskId,
        workspaceId: input.workspaceId,
        environmentId: input.environmentId,
        initiatorUserId: input.initiatorUserId,
        title: `${workflowTitle} · Reviewer ${index + 1}`,
        message: input.message,
        attachments: input.attachments,
        defaultTimezone: input.defaultTimezone,
        tools: input.tools,
        agent: input.agent,
        maxStepsOverride: input.maxStepsOverride,
        allowWaiting: false,
        timeLimitSeconds: input.timeLimitSeconds,
        workflowType: "long_horizon",
        workflowParentTaskId: taskId,
        workflowInternalRole: "reviewer",
        interactiveCanvasId: input.interactiveCanvasId,
        interactiveCanvasIntent: input.interactiveCanvasIntent
      });

      await insertWorkflowAgent(client, {
        workflowTaskId: taskId,
        role: "reviewer",
        slotIndex: index,
        taskId: reviewerTaskId
      });
    }

    if (input.timeLimitSeconds !== null && input.timeLimitSeconds !== undefined) {
      await activateTaskTimeLimitInTx(client, taskId, parent.userMessageCreatedAt);
    }

    return parent;
  });
}

export async function createLongHorizonWorkflowTask(input: LongHorizonWorkflowInput): Promise<{
  taskId: string;
  runId: string;
  userMessageId: string;
  reusedExisting: boolean;
}> {
  const taskId = input.taskId ?? randomUUID();
  const workflowTitle = input.title?.trim()
    || (input.reviewMode === "quality_control"
      ? "Quality Control Task"
      : input.researchMode === "deep_research" ? "Deep Research Task" : "Long Horizon Task");
  const enableClarifyPhase = input.enableClarifyPhase !== false;
  const enableReviewPhase = input.enableReviewPhase !== false;
  const reviewerCount = enableReviewPhase ? LONG_HORIZON_REVIEWER_COUNT : 0;
  const reviewerTaskIds = Array.from({ length: reviewerCount }, () => randomUUID());

  const existingBeforeCreate = input.taskId
    ? await findExistingWorkflowTask(taskId, input, "long_horizon")
    : null;
  if (existingBeforeCreate) {
    return reuseExistingWorkflowTask({
      existing: existingBeforeCreate,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      initiatorUserId: input.initiatorUserId,
      mode: enableClarifyPhase ? "long_horizon_clarify" : "long_horizon_main"
    });
  }

  let created: { userMessageId: string; userMessageCreatedAt: string };
  try {
    created = await createLongHorizonWorkflowRecords(
      input,
      taskId,
      reviewerTaskIds,
      reviewerCount,
      workflowTitle,
      enableClarifyPhase
    );
  } catch (error) {
    if (!input.taskId || !isTaskPrimaryKeyConflict(error)) {
      throw error;
    }
    const existing = await findExistingWorkflowTask(taskId, input, "long_horizon");
    if (!existing) {
      throw error;
    }
    return reuseExistingWorkflowTask({
      existing,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      initiatorUserId: input.initiatorUserId,
      mode: enableClarifyPhase ? "long_horizon_clarify" : "long_horizon_main"
    });
  }

  const run = await ensureWorkflowInitialRun({
    taskId,
    userMessageId: created.userMessageId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    initiatorUserId: input.initiatorUserId,
    mode: enableClarifyPhase ? "long_horizon_clarify" : "long_horizon_main"
  });

  return {
    taskId,
    runId: run.runId,
    userMessageId: created.userMessageId,
    reusedExisting: false
  };
}

export interface TaskWorkflowOverview {
  type: TaskWorkflowType;
  phase: string;
  config: Record<string, unknown>;
  longHorizon?: {
    plan: {
      content: string | null;
      createdAt: string | null;
    };
    latestRound: number;
    latestSubmissionMessage: string | null;
    reviews: Array<{
      id: string;
      round_no: number | null;
      reviewer_task_id: string | null;
      reviewer_slot_index: number | null;
      approved: boolean;
      review: string;
      created_at: string;
    }>;
    reviewers: Array<{
      workflow_agent_id: string;
      task_id: string;
      slot_index: number;
      title: string | null;
      status: string;
      updated_at: string;
    }>;
  };
}

interface TaskWorkflowRecord {
  workflow_type: TaskWorkflowType;
  phase: string;
  config_json: Record<string, unknown>;
  state_json: Record<string, unknown> | null;
}

async function loadLongHorizonWorkflowOverview(
  taskId: string,
  workflow: TaskWorkflowRecord
): Promise<TaskWorkflowOverview> {
  const [planRes, latestSubmitRes, reviewsRes, reviewersRes] = await Promise.all([
    query<{ payload_json: { plan?: string }; created_at: string }>(
      `SELECT payload_json, created_at
         FROM task_workflow_submissions
        WHERE workflow_task_id = $1
          AND submission_type = 'plan'
        ORDER BY created_at DESC
        LIMIT 1`,
      [taskId]
    ),
    query<{ payload_json: { message?: string; roundNo?: number } }>(
      `SELECT payload_json
         FROM task_workflow_submissions
        WHERE workflow_task_id = $1
          AND submission_type = 'long_submit'
        ORDER BY created_at DESC
        LIMIT 1`,
      [taskId]
    ),
    query<{
      id: string;
      round_no: number | null;
      payload_json: { approved?: boolean; review?: string };
      created_at: string;
      reviewer_task_id: string | null;
      reviewer_slot_index: number | null;
    }>(
      `SELECT s.id,
              s.round_no,
              s.payload_json,
              s.created_at,
              a.task_id AS reviewer_task_id,
              a.slot_index AS reviewer_slot_index
         FROM task_workflow_submissions s
         LEFT JOIN task_workflow_agents a
           ON a.id = s.workflow_agent_id
        WHERE s.workflow_task_id = $1
          AND s.submission_type = 'review'
        ORDER BY s.round_no DESC NULLS LAST, a.slot_index ASC, s.created_at ASC`,
      [taskId]
    ),
    query<{
      workflow_agent_id: string;
      task_id: string;
      slot_index: number;
      title: string | null;
      status: string;
      updated_at: string;
    }>(
      `SELECT a.id AS workflow_agent_id,
              a.task_id,
              a.slot_index,
              t.title,
              t.status,
              t.updated_at
         FROM task_workflow_agents a
         JOIN tasks t ON t.id = a.task_id
        WHERE a.workflow_task_id = $1
          AND a.role = 'reviewer'
        ORDER BY a.slot_index ASC`,
      [taskId]
    )
  ]);

  return {
    type: workflow.workflow_type,
    phase: workflow.phase,
    config: workflow.config_json ?? {},
    longHorizon: {
      plan: {
        content: planRes.rows[0]?.payload_json?.plan ?? null,
        createdAt: planRes.rows[0]?.created_at ?? null
      },
      latestRound: Number(latestSubmitRes.rows[0]?.payload_json?.roundNo ?? 0) || 0,
      latestSubmissionMessage: latestSubmitRes.rows[0]?.payload_json?.message ?? null,
      reviews: reviewsRes.rows.map((row) => ({
        id: row.id,
        round_no: row.round_no,
        reviewer_task_id: row.reviewer_task_id,
        reviewer_slot_index: row.reviewer_slot_index,
        approved: row.payload_json?.approved === true,
        review: typeof row.payload_json?.review === "string" ? row.payload_json.review : "",
        created_at: row.created_at
      })),
      reviewers: reviewersRes.rows
    }
  };
}

export async function getTaskWorkflowOverview(taskId: string): Promise<TaskWorkflowOverview | null> {
  const workflowRes = await query<TaskWorkflowRecord>(
    `SELECT workflow_type, phase, config_json, state_json
       FROM task_workflows
      WHERE task_id = $1`,
    [taskId]
  );

  if ((workflowRes.rowCount ?? 0) === 0) {
    const swarm = await query<{ config_json: Record<string, unknown> }>(
      "SELECT config_json FROM task_swarms WHERE task_id = $1", [taskId]
    );
    return swarm.rows[0] ? { type: "agent_swarm", phase: "working", config: swarm.rows[0].config_json } : null;
  }

  const workflow = workflowRes.rows[0];

  return loadLongHorizonWorkflowOverview(taskId, workflow);
}
