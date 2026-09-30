import { randomUUID } from "node:crypto";
import { buildTaskRunQueueJobId, type TaskExecutionJob, type TaskSource } from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { query, withTransaction } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import { isCancellationRequested } from "../agent-db/index.js";
import type { TaskMessageToolOptions } from "../agent/types.js";

const SUBTASK_MAX_DEPTH = 3;
const START_SUBTASK_DEFAULT_TIMEOUT_SECONDS = 60 * 60;
const START_SUBTASK_MIN_TIMEOUT_SECONDS = 30;
const START_SUBTASK_MAX_TIMEOUT_SECONDS = 24 * 60 * 60;
const START_SUBTASK_WAIT_POLL_MS = 2_000;
const START_SUBTASK_MAX_BATCH_SIZE = 50;

interface ParentTaskRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  initiator_user_id: string | null;
  default_timezone: string;
  subtask_depth: number;
  task_root_path: string;
}

interface SubtaskRow {
  id: string;
  title: string | null;
  status: string;
  source: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  final_response: string | null;
  latest_exit_reason: string | null;
  latest_error_summary: string | null;
}

interface SubtaskCreateRow {
  id: string;
  title: string | null;
  status: string;
  subtask_depth: number;
  task_root_path: string;
  created_at: string;
}

export interface SubtaskEnabledToolsInput {
  web_search?: boolean | null;
  memory_search?: boolean | null;
  schedule_task?: boolean | null;
  subtasks?: boolean | null;
  computer_use?: boolean | null;
  enabled_skills?: string[] | null;
  enabled_sources?: string[] | null;
}

export interface CreateSubtaskInput {
  parentTaskId: string;
  workspaceId: string;
  environmentId: string;
  message: string;
  title: string | null;
  enabledTools: SubtaskEnabledToolsInput | null;
  fallbackToolOptions: TaskMessageToolOptions;
}

export interface StartSubtasksInput {
  parentTaskId: string;
  workspaceId: string;
  environmentId: string;
  taskIds: string[];
  timeoutSeconds: number | null;
}

function normalizeTaskSource(rawSource: string): TaskSource {
  if (rawSource === "telegram" || rawSource === "discord" || rawSource === "github" || rawSource === "email") {
    return rawSource;
  }

  return "web";
}

function normalizeTimeoutSeconds(rawTimeoutSeconds: number | null): number {
  if (rawTimeoutSeconds === null) {
    return START_SUBTASK_DEFAULT_TIMEOUT_SECONDS;
  }

  const rounded = Math.floor(rawTimeoutSeconds);
  if (rounded < START_SUBTASK_MIN_TIMEOUT_SECONDS || rounded > START_SUBTASK_MAX_TIMEOUT_SECONDS) {
    throw new Error(
      `timeout_seconds must be between ${START_SUBTASK_MIN_TIMEOUT_SECONDS} and ${START_SUBTASK_MAX_TIMEOUT_SECONDS}`
    );
  }

  return rounded;
}

function normalizeSubtaskIds(taskIds: string[]): string[] {
  const deduped = Array.from(new Set(taskIds));
  if (deduped.length === 0) {
    throw new Error("task_ids must include at least one subtask id");
  }

  if (deduped.length > START_SUBTASK_MAX_BATCH_SIZE) {
    throw new Error(`task_ids cannot contain more than ${START_SUBTASK_MAX_BATCH_SIZE} items`);
  }

  return deduped;
}

function normalizeStringList(rawValues: unknown, fallback: string[]): string[] {
  const raw = Array.isArray(rawValues) ? rawValues : fallback;
  return Array.from(
    new Set(
      raw
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  );
}

function normalizeSubtaskToolOptions(
  input: SubtaskEnabledToolsInput | null,
  fallback: TaskMessageToolOptions
): TaskMessageToolOptions {
  const webSearch = typeof input?.web_search === "boolean" ? input.web_search : fallback.webSearch;
  const memorySearch = typeof input?.memory_search === "boolean" ? input.memory_search : fallback.memorySearch;
  const scheduleTask = typeof input?.schedule_task === "boolean" ? input.schedule_task : fallback.scheduleTask;
  const subtasks = typeof input?.subtasks === "boolean" ? input.subtasks : fallback.subtasks;
  const computerUse = typeof input?.computer_use === "boolean" ? input.computer_use : fallback.computerUse;
  const enabledSkills = normalizeStringList(input?.enabled_skills, fallback.enabledSkills);
  const enabledSources = normalizeStringList(input?.enabled_sources, fallback.enabledSources);

  return {
    webSearch,
    memorySearch,
    scheduleTask,
    subtasks,
    computerUse,
    enabledSkills,
    enabledSources
  };
}

function buildMessageToolPayload(options: TaskMessageToolOptions): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = {};

  if (options.webSearch) {
    payload.webSearch = true;
  }
  if (options.memorySearch) {
    payload.memorySearch = true;
  }
  if (options.scheduleTask) {
    payload.scheduleTask = true;
  }
  if (options.subtasks) {
    payload.subtasks = true;
  }
  if (options.computerUse) {
    payload.computerUse = true;
  }
  if (options.enabledSkills.length > 0) {
    payload.enabledSkills = options.enabledSkills;
  }
  if (options.enabledSources.length > 0) {
    payload.enabledSources = options.enabledSources;
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}

function isTerminalTaskStatus(status: string): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function buildSubtaskRootPath(parentRootPath: string, subtaskId: string): string {
  const normalizedParent = parentRootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return `${normalizedParent}/subtasks/${subtaskId}`;
}

async function getParentTaskOrThrow(input: {
  parentTaskId: string;
  workspaceId: string;
  environmentId: string;
}): Promise<ParentTaskRow> {
  const parentRes = await query<ParentTaskRow>(
    `SELECT id,
            workspace_id,
            environment_id,
            initiator_user_id,
            default_timezone,
            subtask_depth,
            task_root_path
       FROM tasks
      WHERE id = $1`,
    [input.parentTaskId]
  );

  if ((parentRes.rowCount ?? 0) === 0) {
    throw new Error("Parent task not found");
  }

  const parentTask = parentRes.rows[0];
  if (parentTask.workspace_id !== input.workspaceId || parentTask.environment_id !== input.environmentId) {
    throw new Error("Parent task does not belong to this workspace/environment");
  }

  return parentTask;
}

async function loadSubtasksForParent(parentTaskId: string, taskIds: string[]): Promise<SubtaskRow[]> {
  const rows = await query<SubtaskRow>(
    `SELECT t.id,
            t.title,
            t.status,
            t.source,
            t.created_at,
            t.updated_at,
            t.completed_at,
            latest_message.content_json->>'text' AS final_response,
            latest_run.exit_reason AS latest_exit_reason,
            latest_run.error_summary AS latest_error_summary
       FROM tasks t
       LEFT JOIN LATERAL (
         SELECT tm.content_json
           FROM task_messages tm
          WHERE tm.task_id = t.id
            AND tm.role = 'assistant'
          ORDER BY tm.created_at DESC, tm.id DESC
          LIMIT 1
       ) latest_message ON true
       LEFT JOIN LATERAL (
         SELECT tr.exit_reason, tr.error_summary
           FROM task_runs tr
          WHERE tr.task_id = t.id
          ORDER BY tr.attempt_no DESC
          LIMIT 1
       ) latest_run ON true
      WHERE t.parent_task_id = $1
        AND t.id = ANY($2::uuid[])`,
    [parentTaskId, taskIds]
  );

  const byId = new Map(rows.rows.map((row) => [row.id, row]));
  const orderedRows: SubtaskRow[] = [];
  for (const taskId of taskIds) {
    const row = byId.get(taskId);
    if (!row) {
      throw new Error(`Subtask not found for this parent task: ${taskId}`);
    }
    orderedRows.push(row);
  }

  return orderedRows;
}

async function enqueueSubtaskRun(input: {
  taskId: string;
  workspaceId: string;
  environmentId: string;
  triggerSource: TaskSource;
}): Promise<void> {
  const prepared = await withTransaction(async (client) => {
    const taskRes = await client.query<{ id: string; status: string }>(
      `SELECT id, status
         FROM tasks
        WHERE id = $1
        FOR UPDATE`,
      [input.taskId]
    );

    if ((taskRes.rowCount ?? 0) === 0) {
      throw new Error(`Subtask not found: ${input.taskId}`);
    }

    if (taskRes.rows[0].status !== "awaiting_input") {
      return null;
    }

    const runId = randomUUID();
    const attemptRes = await client.query<{ attempt_no: number }>(
      `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
         FROM task_runs
        WHERE task_id = $1`,
      [input.taskId]
    );
    const attemptNo = attemptRes.rows[0].attempt_no;

    await client.query(
      `INSERT INTO task_runs (id, task_id, attempt_no, run_kind)
       VALUES ($1, $2, $3, 'default')`,
      [runId, input.taskId, attemptNo]
    );

    await client.query(
      `UPDATE tasks
          SET status = 'queued',
              cancellation_requested = false,
              resume_after_interrupt = false,
              trashed_at = NULL,
              updated_at = now()
        WHERE id = $1`,
      [input.taskId]
    );

    return {
      runId,
      jobId: buildTaskRunQueueJobId(input.taskId, runId),
      payload: {
        taskId: input.taskId,
        runId,
        workspaceId: input.workspaceId,
        environmentId: input.environmentId,
        triggerSource: input.triggerSource,
        mode: "default"
      } satisfies TaskExecutionJob
    };
  });

  if (!prepared) {
    return;
  }

  await taskQueue.add(prepared.jobId, prepared.payload, {
    jobId: prepared.jobId,
    attempts: 1,
    removeOnComplete: 200,
    removeOnFail: 200
  });
}

async function requestSubtaskCancellation(parentTaskId: string, taskIds: string[]): Promise<void> {
  await withTransaction(async (client) => {
    const cancelledRes = await client.query<{ id: string }>(
      `WITH cancelled AS (
         UPDATE tasks t
            SET cancellation_requested = true,
                resume_after_interrupt = false,
                updated_at = now()
          WHERE t.parent_task_id = $1
            AND t.id = ANY($2::uuid[])
            AND t.status IN ('queued', 'starting', 'running')
          RETURNING t.id
       )
       SELECT id FROM cancelled`,
      [parentTaskId, taskIds]
    );

    const cancelledIds = cancelledRes.rows.map((row) => row.id);
    if (cancelledIds.length === 0) {
      return;
    }

    await client.query(
      `UPDATE task_schedules
          SET schedule_state = 'cancelled',
              next_run_at = NULL,
              pending_run = false,
              cancelled_at = now(),
              updated_at = now()
        WHERE task_id = ANY($1::uuid[])`,
      [cancelledIds]
    );
  });
}

function summarizeSubtaskRows(input: { rows: SubtaskRow[]; timedOut: boolean }): {
  task_id: string;
  title: string | null;
  status: string;
  completed_at: string | null;
  final_response: string | null;
  exit_reason: string | null;
  error_summary: string | null;
  timed_out: boolean;
}[] {
  return input.rows.map((row) => ({
    task_id: row.id,
    title: row.title,
    status: row.status,
    completed_at: row.completed_at,
    final_response: row.final_response,
    exit_reason: row.latest_exit_reason,
    error_summary: row.latest_error_summary,
    timed_out: input.timedOut && !isTerminalTaskStatus(row.status)
  }));
}

export async function createSubtaskFromTool(input: CreateSubtaskInput): Promise<{
  taskId: string;
  title: string | null;
  status: string;
  subtaskDepth: number;
  taskRootPath: string;
  createdAt: string;
}> {
  const parentTask = await getParentTaskOrThrow({
    parentTaskId: input.parentTaskId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId
  });

  if (parentTask.subtask_depth >= SUBTASK_MAX_DEPTH) {
    throw new Error(`Max subtask depth reached (${SUBTASK_MAX_DEPTH})`);
  }

  const nextSubtaskDepth = parentTask.subtask_depth + 1;
  const subtaskId = randomUUID();
  const taskRootPath = buildSubtaskRootPath(parentTask.task_root_path, subtaskId);
  const toolOptions = normalizeSubtaskToolOptions(input.enabledTools, input.fallbackToolOptions);
  const messageToolsPayload = buildMessageToolPayload(toolOptions);

  const createdRes = await withTransaction(async (client) => {
    const insertedTask = await client.query<SubtaskCreateRow>(
      `INSERT INTO tasks (
        id,
        workspace_id,
        environment_id,
        title,
        status,
        source,
        initiator_user_id,
        parent_task_id,
        subtask_depth,
        task_root_path,
        default_timezone
      )
      VALUES ($1, $2, $3, $4, 'awaiting_input', 'web', $5, $6, $7, $8, $9)
      RETURNING id, title, status, subtask_depth, task_root_path, created_at`,
      [
        subtaskId,
        input.workspaceId,
        input.environmentId,
        input.title,
        parentTask.initiator_user_id,
        input.parentTaskId,
        nextSubtaskDepth,
        taskRootPath,
        parentTask.default_timezone
      ]
    );

    const messagePayload: Record<string, unknown> = {
      text: input.message
    };
    if (messageToolsPayload) {
      messagePayload.tools = messageToolsPayload;
    }
    const createdAt = new Date().toISOString();

    await client.query(
      `INSERT INTO task_messages (
        task_id,
        role,
        content_json,
        message_metadata_json,
        author_user_id,
        created_at
      )
      VALUES ($1, 'user', $2::jsonb, $3::jsonb, $4, $5)`,
      [
        subtaskId,
        JSON.stringify(messagePayload),
        JSON.stringify(createTaskMessageMetadata(createdAt)),
        parentTask.initiator_user_id,
        createdAt
      ]
    );

    return insertedTask.rows[0];
  });

  return {
    taskId: createdRes.id,
    title: createdRes.title,
    status: createdRes.status,
    subtaskDepth: createdRes.subtask_depth,
    taskRootPath: createdRes.task_root_path,
    createdAt: createdRes.created_at
  };
}

export async function startSubtasksFromTool(input: StartSubtasksInput): Promise<{
  ok: boolean;
  timed_out: boolean;
  timeout_seconds: number;
  subtasks: Array<{
    task_id: string;
    title: string | null;
    status: string;
    completed_at: string | null;
    final_response: string | null;
    exit_reason: string | null;
    error_summary: string | null;
    timed_out: boolean;
  }>;
}> {
  const timeoutSeconds = normalizeTimeoutSeconds(input.timeoutSeconds);
  const taskIds = normalizeSubtaskIds(input.taskIds);

  await getParentTaskOrThrow({
    parentTaskId: input.parentTaskId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId
  });

  const initialRows = await loadSubtasksForParent(input.parentTaskId, taskIds);

  const hasNonTerminalSubtask = initialRows.some((row) => !isTerminalTaskStatus(row.status));
  if (hasNonTerminalSubtask && config.runtime.workerConcurrency < 2) {
    throw new Error("start_subtask requires runtime.workerConcurrency >= 2 to avoid deadlock while waiting.");
  }

  for (const row of initialRows) {
    if (row.status !== "awaiting_input") {
      continue;
    }

    await enqueueSubtaskRun({
      taskId: row.id,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      triggerSource: normalizeTaskSource(row.source)
    });
  }

  const timeoutAt = Date.now() + timeoutSeconds * 1000;

  while (true) {
    const rows = await loadSubtasksForParent(input.parentTaskId, taskIds);
    if (rows.every((row) => isTerminalTaskStatus(row.status))) {
      return {
        ok: true,
        timed_out: false,
        timeout_seconds: timeoutSeconds,
        subtasks: summarizeSubtaskRows({ rows, timedOut: false })
      };
    }

    if (await isCancellationRequested(input.parentTaskId)) {
      await requestSubtaskCancellation(input.parentTaskId, taskIds);
      throw new Error("TASK_CANCELLED");
    }

    if (Date.now() >= timeoutAt) {
      await requestSubtaskCancellation(input.parentTaskId, taskIds);
      const timedOutRows = await loadSubtasksForParent(input.parentTaskId, taskIds);
      return {
        ok: false,
        timed_out: true,
        timeout_seconds: timeoutSeconds,
        subtasks: summarizeSubtaskRows({ rows: timedOutRows, timedOut: true })
      };
    }

    await new Promise((resolve) => setTimeout(resolve, START_SUBTASK_WAIT_POLL_MS));
  }
}
import { createTaskMessageMetadata } from "@meowbert/shared";
