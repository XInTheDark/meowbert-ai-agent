import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { createTaskMessageMetadata } from "@meowbert/shared";
import type { TaskWorkflowType, TaskExecutionJob, TaskSource } from "@meowbert/shared";
import { query, withTransaction } from "../../../lib/db.js";
import { setTaskBranchSelection } from "./branching.js";
import { ensureDispatchedRun, enqueueRun } from "./runs.js";
import {
  buildUserMessageContent,
  normalizeTaskMessageToolOptions,
  type TaskMessageAttachment,
  type TaskMessageAgentSelection,
  type TaskMessageSender,
  type TaskMessageToolOptions,
  type TaskPrefaceMessage
} from "./shared.js";
import { activateTaskTimeLimitInTx } from "./time-limit.js";
import { ensureTaskPromptEntitlement, recordTaskPromptUsage } from "./prompt-usage.js";
import type { ProjectCanvasIntent } from "../../canvases/project-canvases.js";

interface CreateTaskInput {
  taskId?: string;
  workspaceId: string;
  environmentId: string;
  source: TaskSource;
  initiatorUserId?: string;
  selectionUserId?: string;
  connectorContextId?: string;
  title?: string;
  message: string;
  sender?: TaskMessageSender;
  attachments?: TaskMessageAttachment[];
  tools?: TaskMessageToolOptions;
  agent?: TaskMessageAgentSelection;
  defaultTimezone?: string;
  maxStepsOverride?: number | null;
  allowWaiting?: boolean | null;
  timeLimitSeconds?: number | null;
  isIncognito?: boolean;
  prefaceMessages?: TaskPrefaceMessage[];
  schedule?: {
    mode: "scheduled" | "infinite";
    repeat: string | null;
    timezone: string;
    nextRunAt: string | null;
    enabledTools?: TaskMessageToolOptions;
    createdByUserId?: string | null;
    createdFromTaskId?: string | null;
    runTimeoutSeconds?: number | null;
    runDeadlineAt?: string | null;
  } | null;
  initialRunMode?: TaskExecutionJob["mode"];
  initialRunToolOptionsOverride?: TaskMessageToolOptions;
  initialRunQuickMode?: boolean;
  interactiveCanvasId?: string | null;
  interactiveCanvasIntent?: ProjectCanvasIntent | null;
  workflowType?: TaskWorkflowType | null;
  workflowParentTaskId?: string | null;
  workflowInternalRole?: "reviewer" | "leader" | "worker" | null;
}

async function insertTaskRow(
  client: PoolClient,
  input: CreateTaskInput,
  taskId: string
): Promise<void> {
  await client.query(
    `INSERT INTO tasks (
      id,
      workspace_id,
      environment_id,
      title,
      status,
      source,
      initiator_user_id,
      connector_context_id,
      default_timezone,
      max_steps_override,
      allow_waiting,
      time_limit_seconds,
      is_incognito,
      task_root_path,
      interactive_canvas_id,
      interactive_canvas_intent,
      workflow_type,
      workflow_parent_task_id,
      workflow_internal_role
    ) VALUES ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
    [
      taskId,
      input.workspaceId,
      input.environmentId,
      input.title ?? null,
      input.source,
      input.initiatorUserId ?? null,
      input.connectorContextId ?? null,
      input.defaultTimezone ?? "UTC",
      input.maxStepsOverride ?? null,
      input.allowWaiting ?? true,
      input.timeLimitSeconds ?? null,
      input.isIncognito === true,
      `.meowbert/task-runs/${taskId}`,
      input.interactiveCanvasId ?? null,
      input.interactiveCanvasIntent ?? null,
      input.workflowType ?? null,
      input.workflowParentTaskId ?? null,
      input.workflowInternalRole ?? null
    ]
  );
}

async function insertPrefaceMessages(
  client: PoolClient,
  taskId: string,
  prefaceMessages: TaskPrefaceMessage[],
  createdAtBase: number
): Promise<string | null> {
  let previousMessageId: string | null = null;

  for (let index = 0; index < prefaceMessages.length; index += 1) {
    const preface = prefaceMessages[index];
    const createdAt = new Date(createdAtBase + index).toISOString();
    previousMessageId = (
      await client.query<{ id: string }>(
        `INSERT INTO task_messages (
          task_id,
          role,
          content_json,
          message_metadata_json,
          parent_message_id,
          created_at
        )
        VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)
        RETURNING id`,
        [
          taskId,
          preface.role,
          JSON.stringify(preface.content),
          JSON.stringify(createTaskMessageMetadata(createdAt)),
          previousMessageId,
          createdAt
        ]
      )
    ).rows[0].id;
  }

  return previousMessageId;
}

async function insertUserMessage(
  client: PoolClient,
  input: CreateTaskInput,
  taskId: string,
  parentMessageId: string | null,
  createdAt: number
): Promise<{ id: string; created_at: string }> {
  const createdAtIso = new Date(createdAt).toISOString();
  const insertedUser = await client.query<{ id: string; created_at: string }>(
    `INSERT INTO task_messages (
      task_id,
      role,
      content_json,
      message_metadata_json,
      author_user_id,
      parent_message_id,
      created_at
    )
    VALUES ($1, 'user', $2::jsonb, $3::jsonb, $4, $5, $6)
    RETURNING id, created_at`,
    [
      taskId,
      JSON.stringify(
        buildUserMessageContent({
          message: input.message,
          sender: input.sender,
          attachments: input.attachments,
          tools: input.tools,
          agent: input.agent
        })
      ),
      JSON.stringify(createTaskMessageMetadata(createdAtIso)),
      input.initiatorUserId ?? null,
      parentMessageId,
      createdAtIso
    ]
  );

  return insertedUser.rows[0];
}

async function insertTaskSchedule(
  client: PoolClient,
  taskId: string,
  schedule: NonNullable<CreateTaskInput["schedule"]>
): Promise<void> {
  await client.query(
    `INSERT INTO task_schedules (
      task_id,
      mode,
      schedule_state,
      repeat_cron,
      timezone,
      next_run_at,
      pending_run,
      enabled_tools_json,
      created_by_user_id,
      created_from_task_id,
      run_timeout_seconds,
      run_deadline_at
    )
    VALUES ($1, $2, 'active', $3, $4, $5, false, $6::jsonb, $7, $8, $9, $10)`,
    [
      taskId,
      schedule.mode,
      schedule.repeat,
      schedule.timezone,
      schedule.nextRunAt,
      JSON.stringify(normalizeTaskMessageToolOptions(schedule.enabledTools) ?? {}),
      schedule.createdByUserId ?? null,
      schedule.createdFromTaskId ?? null,
      schedule.runTimeoutSeconds ?? null,
      schedule.runDeadlineAt ?? null
    ]
  );
}

async function createTaskRecords(input: CreateTaskInput, taskId: string, selectionUserId?: string): Promise<string> {
  return withTransaction(async (client) => {
    await insertTaskRow(client, input, taskId);

    const prefaceMessages = input.prefaceMessages ?? [];
    const createdAtBase = Date.now();
    const lastPrefaceMessageId = await insertPrefaceMessages(
      client,
      taskId,
      prefaceMessages,
      createdAtBase
    );
    const insertedUserMessage = await insertUserMessage(
      client,
      input,
      taskId,
      lastPrefaceMessageId,
      createdAtBase + prefaceMessages.length
    );
    const userMessageId = insertedUserMessage.id;

    if (selectionUserId) {
      await setTaskBranchSelection({
        taskId,
        userId: selectionUserId,
        activeLeafMessageId: userMessageId,
        client
      });
    }

    if (input.schedule) {
      await insertTaskSchedule(client, taskId, input.schedule);
    }

    if (input.timeLimitSeconds !== null && input.timeLimitSeconds !== undefined) {
      await activateTaskTimeLimitInTx(client, taskId, insertedUserMessage.created_at);
    }

    return userMessageId;
  });
}

interface ExistingTaskCreateMatchRow {
  task_id: string;
  user_message_id: string | null;
  run_id: string | null;
}

interface ExistingTaskCreateSnapshotRow extends ExistingTaskCreateMatchRow {
  workspace_id: string;
  environment_id: string;
  source: TaskSource;
  initiator_user_id: string | null;
  connector_context_id: string | null;
}

function isTaskPrimaryKeyConflict(error: unknown): boolean {
  return (error as { code?: string }).code === "23505"
    && (error as { constraint?: string }).constraint === "tasks_pkey";
}

function buildExistingTaskCreateMatch(
  input: CreateTaskInput,
  snapshot: ExistingTaskCreateSnapshotRow | null
): ExistingTaskCreateMatchRow | null {
  if (!snapshot?.user_message_id) {
    return null;
  }

  // Explicit client-generated task ids act as retry idempotency keys, so only
  // the task's ownership/context needs to match before we reuse it.
  const matches =
    snapshot.workspace_id === input.workspaceId
    && snapshot.environment_id === input.environmentId
    && snapshot.source === input.source
    && snapshot.initiator_user_id === (input.initiatorUserId ?? null)
    && snapshot.connector_context_id === (input.connectorContextId ?? null);

  if (!matches) {
    return null;
  }

  return {
    task_id: snapshot.task_id,
    user_message_id: snapshot.user_message_id,
    run_id: snapshot.run_id
  };
}

async function findExistingTaskCreateMatch(taskId: string, input: CreateTaskInput): Promise<ExistingTaskCreateMatchRow | null> {
  const result = await query<ExistingTaskCreateSnapshotRow>(
    `SELECT t.id AS task_id,
            t.workspace_id,
            t.environment_id,
            t.source,
            t.initiator_user_id,
            t.connector_context_id,
            initial_user.id AS user_message_id,
            latest_run.id AS run_id
       FROM tasks t
       LEFT JOIN LATERAL (
         SELECT tm.id
           FROM task_messages tm
          WHERE tm.task_id = t.id
            AND tm.role = 'user'
          ORDER BY tm.created_at ASC, tm.id ASC
          LIMIT 1
       ) AS initial_user ON true
       LEFT JOIN LATERAL (
         SELECT tr.id
           FROM task_runs tr
          WHERE tr.task_id = t.id
          ORDER BY tr.attempt_no DESC, tr.id DESC
          LIMIT 1
       ) AS latest_run ON true
      WHERE t.id = $1
      LIMIT 1`,
    [taskId]
  );

  return buildExistingTaskCreateMatch(input, result.rows[0] ?? null);
}

async function ensureTaskCreateRun(
  input: CreateTaskInput,
  taskId: string,
  userMessageId: string,
  selectionUserId: string | undefined,
  existingRunId: string | null
): Promise<string> {
  if (existingRunId) {
    return existingRunId;
  }

  const run = await ensureDispatchedRun({
    taskId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    triggerSource: input.source,
    mode: input.initialRunMode,
    branchMessageId: userMessageId,
    selectionUserId,
    priorityActorUserId: selectionUserId,
    dispatchCategory: input.schedule ? "background" : "new",
    toolOptionsOverride: normalizeTaskMessageToolOptions(input.initialRunToolOptionsOverride),
    quickMode: input.initialRunQuickMode === true
  });

  return run.runId;
}

export async function createTaskWithInitialMessage(
  input: CreateTaskInput
): Promise<{ taskId: string; runId: string; userMessageId: string; reusedExisting: boolean }> {
  const normalizedInput =
    input.source !== "web" && !input.initiatorUserId && input.selectionUserId
      ? {
          ...input,
          initiatorUserId: input.selectionUserId
        }
      : input;
  const taskId = input.taskId ?? randomUUID();
  const promptUserId = normalizedInput.initiatorUserId ?? normalizedInput.selectionUserId ?? null;
  const entitlement = await ensureTaskPromptEntitlement({
    source: normalizedInput.source,
    userId: promptUserId
  });
  const selectionUserId = normalizedInput.selectionUserId ?? normalizedInput.initiatorUserId;
  const existingBeforeCreate = input.taskId
    ? await findExistingTaskCreateMatch(taskId, normalizedInput)
    : null;

  if (existingBeforeCreate?.user_message_id) {
    return {
      taskId,
      runId: await ensureTaskCreateRun(
        normalizedInput,
        taskId,
        existingBeforeCreate.user_message_id,
        selectionUserId,
        existingBeforeCreate.run_id
      ),
      userMessageId: existingBeforeCreate.user_message_id,
      reusedExisting: true
    };
  }

  let userMessageId: string;
  let runId: string;
  let reusedExisting = false;

  try {
    userMessageId = await createTaskRecords(normalizedInput, taskId, selectionUserId);
    const run = await enqueueRun({
      taskId,
      workspaceId: normalizedInput.workspaceId,
      environmentId: normalizedInput.environmentId,
      triggerSource: normalizedInput.source,
      mode: normalizedInput.initialRunMode,
      branchMessageId: userMessageId,
      selectionUserId,
      priorityActorUserId: selectionUserId,
      dispatchCategory: normalizedInput.schedule ? "background" : "new",
      toolOptionsOverride: normalizeTaskMessageToolOptions(normalizedInput.initialRunToolOptionsOverride),
      quickMode: normalizedInput.initialRunQuickMode === true
    });
    runId = run.runId;
    await recordTaskPromptUsage({
      entitlement,
      userId: promptUserId,
      taskId,
      taskMessageId: userMessageId
    });
  } catch (error) {
    if (!input.taskId || !isTaskPrimaryKeyConflict(error)) {
      throw error;
    }

    const existing = await findExistingTaskCreateMatch(taskId, normalizedInput);
    if (!existing?.user_message_id) {
      throw error;
    }

    reusedExisting = true;
    userMessageId = existing.user_message_id;
    runId = await ensureTaskCreateRun(normalizedInput, taskId, userMessageId, selectionUserId, existing.run_id);
  }

  return {
    taskId,
    runId,
    userMessageId,
    reusedExisting
  };
}
