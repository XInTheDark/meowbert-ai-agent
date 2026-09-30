import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { TaskWorkflowType } from "@meowbert/shared";
import { extractTaskSearchableText } from "@meowbert/shared/task-history-search";
import { query } from "../../lib/db.js";
import { listTaskCanvases } from "../../services/canvases/project-canvases.js";
import { listTaskThreadCounts } from "../../services/tasks/task-threads.js";
import { selectTaskMessageMetadataContent } from "../../services/tasks/task-message-metadata-content.js";
import { resolveActiveLeafMessageId } from "../../services/tasks/task-service/index.js";
import { getAdminSettings } from "../../services/admin/admin-settings.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import { getTaskWorkflowOverview } from "../../services/tasks/task-workflows.js";
import { ensureTaskHistoryWarm } from "../../services/tasks/task-history.js";
import {
  sanitizeContextUsagePayloadForDebugMode,
  sanitizeTaskMessageForDebugMode
} from "../../services/tasks/task-debug-visibility.js";
import {
  buildTaskScheduleResponse,
  publicTaskShareParams,
  taskConversationQuery,
  taskConversationSearchQuery,
  taskDetailQuery,
  taskMessageContentBody,
  taskParams,
  uniqueIdsPreserveOrder
} from "./shared.js";

interface TaskMessageRow {
  id: string;
  role: string;
  content_json: Record<string, unknown>;
  message_metadata_json?: Record<string, unknown> | null;
  author_user_id?: string | null;
  author_email?: string | null;
  author_display_name?: string | null;
  parent_message_id: string | null;
  edited_from_message_id: string | null;
  created_at: string;
}

interface TaskMessageResponse extends Omit<TaskMessageRow, "author_user_id" | "author_email" | "author_display_name"> {
  author?: {
    id: string;
    email: string;
    display_name: string | null;
  } | null;
}

interface TaskDetailRow {
  id: string;
  title: string | null;
  status: string;
  cancellation_requested: boolean;
  resume_after_interrupt: boolean;
  workspace_id: string;
  environment_id: string;
  source: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  trashed_at: string | null;
  is_incognito: boolean;
  default_timezone: string;
  max_steps_override: number | null;
  time_limit_seconds: number | null;
  allow_waiting: boolean;
  parent_task_id: string | null;
  subtask_depth: number;
  task_root_path: string;
  workflow_type: TaskWorkflowType | null;
  interactive_canvas_id: string | null;
  interactive_canvas_intent: "create" | "update" | "view" | null;
  is_thread: boolean;
  is_project_master: boolean;
  thread_parent_task_id: string | null;
  thread_parent_message_id: string | null;
  thread_selected_text: string | null;
  thread_agent_id: string | null;
  public_share_id: string | null;
  public_shared_at: string | null;
  schedule_mode: "scheduled" | "infinite" | null;
  task_type: "standard" | "scheduled" | "infinite" | "timed" | "long_horizon" | "agent_swarm";
  schedule_state: "active" | "paused" | "cancelled" | null;
  schedule_repeat_cron: string | null;
  schedule_timezone: string | null;
  schedule_next_run_at: string | null;
  schedule_pending_run: boolean | null;
  schedule_run_timeout_seconds: number | null;
  schedule_run_deadline_at: string | null;
}

interface TaskRunRow {
  id: string;
  attempt_no: number;
  started_at: string;
  ended_at: string | null;
  exit_reason: string | null;
}

interface TaskConversationLineageRow {
  id: string;
  role: string;
  content_json: Record<string, unknown>;
  message_metadata_json?: Record<string, unknown> | null;
  author_user_id?: string | null;
  author_email?: string | null;
  author_display_name?: string | null;
  parent_message_id: string | null;
  edited_from_message_id: string | null;
  created_at: string;
  branch_index: number | string;
}

interface TaskConversationSiblingRow {
  message_id: string;
  sibling_id: string;
  sibling_created_at: string;
  sibling_order: number | string;
  sibling_count: number | string;
  sibling_leaf_message_id: string | null;
}

interface TaskConversationBranchOption {
  current_index: number;
  sibling_count: number;
  items: Array<{
    message_id: string;
    leaf_message_id: string | null;
    index: number;
  }>;
}

interface TaskConversationResponse {
  active_leaf_message_id: string | null;
  messages: TaskMessageResponse[];
  message_page: {
    start_index: number;
    end_index: number;
    total_items: number;
    has_older: boolean;
    has_newer: boolean;
  };
  branch_options: Record<string, TaskConversationBranchOption>;
}

interface SubtaskRow {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface ContextUsageRow {
  payload_json: {
    usedTokens?: number;
    maxContextTokens?: number;
    utilization?: number;
    source?: string;
    stage?: string;
    step?: number;
  };
  created_at: string;
}

function normalizeQueryInteger(value: number | string, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function serializeTaskMessageRow(row: TaskMessageRow): TaskMessageResponse {
  const { author_user_id, author_email, author_display_name, ...message } = row;
  const serialized: TaskMessageResponse = {
    ...message,
    author: author_user_id && author_email
      ? {
          id: author_user_id,
          email: author_email,
          display_name: author_display_name ?? null
        }
      : null
  };

  if (!row.message_metadata_json) {
    delete serialized.message_metadata_json;
  }

  if (!serialized.author) {
    delete serialized.author;
  }

  return serialized;
}

interface PublicTaskRow {
  id: string;
  title: string | null;
  status: string;
  source: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  parent_task_id: string | null;
  subtask_depth: number;
  workflow_type: TaskWorkflowType | null;
  schedule_mode: "scheduled" | "infinite" | null;
  task_type: "standard" | "scheduled" | "infinite" | "timed" | "long_horizon" | "agent_swarm";
  schedule_state: "active" | "paused" | "cancelled" | null;
  schedule_repeat_cron: string | null;
  schedule_timezone: string | null;
  schedule_next_run_at: string | null;
  schedule_pending_run: boolean | null;
  schedule_run_timeout_seconds: number | null;
  schedule_run_deadline_at: string | null;
}

async function loadTaskMessages(taskId: string, messageDetail: "full" | "metadata" | "none"): Promise<TaskMessageResponse[]> {
  if (messageDetail === "none") {
    return [];
  }

  if (messageDetail === "metadata") {
    const messagesRes = await query<TaskMessageRow>(
      `SELECT tm.id,
              tm.role,
              CASE
                WHEN tm.role = 'tool' THEN jsonb_strip_nulls(
                  jsonb_build_object(
                    'tool', tm.content_json->'tool',
                    'callId', tm.content_json->'callId',
                    'durationMs', tm.content_json->'durationMs',
                    'inline_artifact', tm.content_json->'inline_artifact',
                    'response_function_output', tm.content_json->'response_function_output',
                    'response_custom_tool_output', tm.content_json->'response_custom_tool_output'
                  )
                )
                ELSE '{}'::jsonb
              END AS content_json,
              tm.message_metadata_json,
              tm.author_user_id,
              author.email AS author_email,
              author.display_name AS author_display_name,
              tm.parent_message_id,
              tm.edited_from_message_id,
              tm.created_at
         FROM task_messages tm
    LEFT JOIN users author ON author.id = tm.author_user_id
        WHERE tm.task_id = $1
        ORDER BY tm.created_at ASC, tm.id ASC`,
      [taskId]
    );

    return messagesRes.rows.map((row) => serializeTaskMessageRow({
      ...row,
      content_json: selectTaskMessageMetadataContent(row.role, row.content_json)
    }));
  }

  const messagesRes = await query<TaskMessageRow>(
    `SELECT tm.id,
            tm.role,
            tm.content_json,
            tm.message_metadata_json,
            tm.author_user_id,
            author.email AS author_email,
            author.display_name AS author_display_name,
            tm.parent_message_id,
            tm.edited_from_message_id,
            tm.created_at
       FROM task_messages tm
  LEFT JOIN users author ON author.id = tm.author_user_id
      WHERE tm.task_id = $1
      ORDER BY tm.created_at ASC, tm.id ASC`,
    [taskId]
  );

  return messagesRes.rows.map(serializeTaskMessageRow);
}

function selectConversationMessageContent(row: Pick<TaskConversationLineageRow, "role" | "content_json">): Record<string, unknown> {
  if (row.role === "tool") {
    return selectTaskMessageMetadataContent(row.role, row.content_json);
  }

  return row.content_json;
}

async function resolveConversationLeafMessageId(input: {
  taskId: string;
  userId: string;
  requestedActiveLeafMessageId?: string;
}): Promise<string | null> {
  const requestedLeaf = input.requestedActiveLeafMessageId ?? null;
  if (requestedLeaf) {
    const requestedLeafRes = await query<{ id: string }>(
      `SELECT id FROM task_messages WHERE task_id = $1 AND id = $2`,
      [input.taskId, requestedLeaf]
    );
    if ((requestedLeafRes.rowCount ?? 0) > 0) {
      return requestedLeaf;
    }
  }
  return resolveActiveLeafMessageId({ taskId: input.taskId, userId: input.userId });
}

async function loadConversationLineage(
  taskId: string,
  activeLeafMessageId: string
): Promise<TaskConversationLineageRow[]> {
  const lineageRes = await query<TaskConversationLineageRow>(
    `WITH RECURSIVE lineage AS (
        SELECT
          tm.id, tm.role, tm.content_json, tm.message_metadata_json,
          tm.author_user_id, tm.parent_message_id, tm.edited_from_message_id,
          tm.created_at, 0 AS depth
        FROM task_messages tm
        WHERE tm.task_id = $1 AND tm.id = $2
        UNION ALL
        SELECT
          parent.id, parent.role, parent.content_json, parent.message_metadata_json,
          parent.author_user_id, parent.parent_message_id, parent.edited_from_message_id,
          parent.created_at, lineage.depth + 1 AS depth
        FROM task_messages parent
        JOIN lineage ON lineage.parent_message_id = parent.id
        WHERE parent.task_id = $1
      ),
      ordered AS (
        SELECT
          id, role, content_json, message_metadata_json, author_user_id,
          parent_message_id, edited_from_message_id, created_at,
          ROW_NUMBER() OVER (ORDER BY depth DESC) - 1 AS branch_index
        FROM lineage
      )
      SELECT
        ordered.id, ordered.role, ordered.content_json, ordered.message_metadata_json,
        ordered.author_user_id, author.email AS author_email,
        author.display_name AS author_display_name,
        ordered.parent_message_id, ordered.edited_from_message_id,
        ordered.created_at, ordered.branch_index
      FROM ordered
      LEFT JOIN users author ON author.id = ordered.author_user_id
      ORDER BY ordered.branch_index ASC`,
    [taskId, activeLeafMessageId]
  );
  return lineageRes.rows;
}

function resolveConversationPageBounds(
  lineageRows: TaskConversationLineageRow[],
  input: { limit: number; beforeIndex?: number; afterIndex?: number; targetMessageId?: string }
): { startIndex: number; endIndexExclusive: number } {
  const totalItems = lineageRows.length;
  if (typeof input.beforeIndex === "number") {
    const endIndexExclusive = Math.max(0, Math.min(totalItems, input.beforeIndex));
    return { startIndex: Math.max(0, endIndexExclusive - input.limit), endIndexExclusive };
  }
  if (typeof input.afterIndex === "number") {
    const startIndex = Math.max(0, Math.min(totalItems, input.afterIndex + 1));
    return { startIndex, endIndexExclusive: Math.min(totalItems, startIndex + input.limit) };
  }
  if (input.targetMessageId) {
    const targetIndex = lineageRows.findIndex((row) => row.id === input.targetMessageId);
    if (targetIndex >= 0) {
      const startIndex = Math.min(targetIndex, Math.max(0, totalItems - input.limit));
      return { startIndex, endIndexExclusive: Math.min(totalItems, startIndex + input.limit) };
    }
  }
  return {
    startIndex: Math.max(0, totalItems - input.limit),
    endIndexExclusive: totalItems
  };
}

async function loadConversationBranchOptions(
  taskId: string,
  pageMessageIds: string[]
): Promise<Record<string, TaskConversationBranchOption>> {
  if (pageMessageIds.length === 0) {
    return {};
  }
  const siblingRes = await query<TaskConversationSiblingRow>(
    `WITH selected_messages AS (
        SELECT * FROM unnest($2::uuid[]) WITH ORDINALITY AS input(id, ord)
      ),
      sibling_groups AS (
        SELECT
          selected.id AS message_id,
          sibling.id AS sibling_id,
          sibling.created_at AS sibling_created_at,
          ROW_NUMBER() OVER (
            PARTITION BY selected.id ORDER BY sibling.created_at ASC, sibling.id ASC
          ) - 1 AS sibling_order,
          COUNT(*) OVER (PARTITION BY selected.id) AS sibling_count
        FROM selected_messages selected
        JOIN task_messages current_message
          ON current_message.task_id = $1 AND current_message.id = selected.id
        JOIN task_messages sibling
          ON sibling.task_id = current_message.task_id
         AND sibling.parent_message_id IS NOT DISTINCT FROM current_message.parent_message_id
      )
      SELECT
        sibling_groups.message_id,
        sibling_groups.sibling_id,
        sibling_groups.sibling_created_at,
        sibling_groups.sibling_order,
        sibling_groups.sibling_count,
        leaf.id AS sibling_leaf_message_id
      FROM sibling_groups
      LEFT JOIN LATERAL (
        WITH RECURSIVE descendants AS (
          SELECT tm.id, tm.created_at
            FROM task_messages tm
           WHERE tm.task_id = $1 AND tm.id = sibling_groups.sibling_id
          UNION ALL
          SELECT child.id, child.created_at
            FROM task_messages child
            JOIN descendants ON child.parent_message_id = descendants.id
           WHERE child.task_id = $1
        )
        SELECT descendants.id
          FROM descendants
         WHERE NOT EXISTS (
           SELECT 1 FROM task_messages child
            WHERE child.task_id = $1 AND child.parent_message_id = descendants.id
         )
         ORDER BY descendants.created_at DESC, descendants.id DESC
         LIMIT 1
      ) AS leaf ON TRUE
      ORDER BY sibling_groups.message_id ASC, sibling_groups.sibling_order ASC`,
    [taskId, pageMessageIds]
  );
  const branchOptions: Record<string, TaskConversationBranchOption> = {};
  for (const row of siblingRes.rows) {
    const siblingOrder = normalizeQueryInteger(row.sibling_order, -1);
    const siblingCount = normalizeQueryInteger(row.sibling_count, 0);
    branchOptions[row.message_id] ??= {
      current_index: siblingOrder,
      sibling_count: siblingCount,
      items: []
    };
    const entry = branchOptions[row.message_id];
    entry.items.push({
      message_id: row.sibling_id,
      leaf_message_id: row.sibling_leaf_message_id,
      index: siblingOrder
    });
    if (row.sibling_id === row.message_id) {
      entry.current_index = siblingOrder;
    }
  }
  return branchOptions;
}

function serializeConversationLineageRow(row: TaskConversationLineageRow) {
  return serializeTaskMessageRow({
    id: row.id,
    role: row.role,
    content_json: selectConversationMessageContent(row),
    message_metadata_json: row.message_metadata_json,
    author_user_id: row.author_user_id,
    author_email: row.author_email,
    author_display_name: row.author_display_name,
    parent_message_id: row.parent_message_id,
    edited_from_message_id: row.edited_from_message_id,
    created_at: row.created_at
  });
}

async function loadTaskConversationPage(input: {
  taskId: string;
  userId: string;
  limit: number;
  beforeIndex?: number;
  afterIndex?: number;
  targetMessageId?: string;
  requestedActiveLeafMessageId?: string;
}): Promise<TaskConversationResponse> {
  const activeLeafMessageId = await resolveConversationLeafMessageId(input);
  if (!activeLeafMessageId) {
    return {
      active_leaf_message_id: null,
      messages: [],
      message_page: { start_index: 0, end_index: 0, total_items: 0, has_older: false, has_newer: false },
      branch_options: {}
    };
  }
  const lineageRows = await loadConversationLineage(input.taskId, activeLeafMessageId);
  const totalItems = lineageRows.length;
  const { startIndex, endIndexExclusive } = resolveConversationPageBounds(lineageRows, input);
  const pageRows = lineageRows.slice(startIndex, endIndexExclusive);
  return {
    active_leaf_message_id: activeLeafMessageId,
    messages: pageRows.map(serializeConversationLineageRow),
    message_page: {
      start_index: startIndex,
      end_index: endIndexExclusive,
      total_items: totalItems,
      has_older: startIndex > 0,
      has_newer: endIndexExclusive < totalItems
    },
    branch_options: await loadConversationBranchOptions(input.taskId, pageRows.map((row) => row.id))
  };
}

async function loadTaskDetailRecord(taskId: string) {
  return query<TaskDetailRow>(
    `SELECT t.id,
          t.title,
          t.status,
          t.cancellation_requested,
          t.resume_after_interrupt,
          t.workspace_id,
          t.environment_id,
          t.source,
          t.created_at,
          t.updated_at,
          t.completed_at,
          t.trashed_at,
          t.is_incognito,
          t.default_timezone,
          t.max_steps_override,
          t.time_limit_seconds,
          t.allow_waiting,
          t.parent_task_id,
          t.subtask_depth,
          t.task_root_path,
          t.workflow_type,
          t.interactive_canvas_id,
          t.interactive_canvas_intent,
          (tt.task_id IS NOT NULL) AS is_thread,
          EXISTS (SELECT 1 FROM project_masters pm WHERE pm.task_id = t.id) AS is_project_master,
          tt.parent_task_id AS thread_parent_task_id,
          tt.parent_message_id AS thread_parent_message_id,
          tt.selected_text AS thread_selected_text,
          tt.agent_id AS thread_agent_id,
          t.public_share_id,
          t.public_shared_at,
          ts.mode AS schedule_mode,
          CASE
            WHEN t.workflow_type IS NOT NULL THEN t.workflow_type
            WHEN ts.task_id IS NULL THEN 'standard'
            WHEN ts.mode = 'infinite' AND ts.run_timeout_seconds IS NOT NULL THEN 'timed'
            ELSE ts.mode
          END AS task_type,
          ts.schedule_state,
          ts.repeat_cron AS schedule_repeat_cron,
          ts.timezone AS schedule_timezone,
          ts.next_run_at AS schedule_next_run_at,
          ts.pending_run AS schedule_pending_run,
          ts.run_timeout_seconds AS schedule_run_timeout_seconds,
          ts.run_deadline_at AS schedule_run_deadline_at
     FROM tasks t
     LEFT JOIN task_threads tt ON tt.task_id = t.id
     LEFT JOIN task_schedules ts ON ts.task_id = t.id
    WHERE t.id = $1`,
    [taskId]
  );
}

async function handleGetTaskDetail(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  const queryInput = taskDetailQuery.parse(request.query ?? {});
  await assertTaskMember(params.taskId, request.user.id);
  if (queryInput.messageDetail === "full") {
    await ensureTaskHistoryWarm(params.taskId);
  }

  const [taskRes, messages, runsRes, contextUsageRes, activeLeafMessageId, subtasksRes, threadCounts, adminSettings, workflow] = await Promise.all([
    loadTaskDetailRecord(params.taskId),
    loadTaskMessages(params.taskId, queryInput.messageDetail),
    query<TaskRunRow>(
      `SELECT id, attempt_no, started_at, ended_at, exit_reason
         FROM task_runs
        WHERE task_id = $1
        ORDER BY attempt_no DESC`,
      [params.taskId]
    ),
    query<ContextUsageRow>(
      `SELECT payload_json, created_at
         FROM task_events
        WHERE task_id = $1
          AND type = 'context_usage'
        ORDER BY CASE
                   WHEN payload_json ->> 'source' = 'actual' THEN 0
                   ELSE 1
                 END ASC,
                 created_at DESC,
                 id DESC
        LIMIT 1`,
      [params.taskId]
    ),
    resolveActiveLeafMessageId({ taskId: params.taskId, userId: request.user.id }),
    query<SubtaskRow>(
      `SELECT id, title, status, created_at, updated_at, completed_at
         FROM tasks
        WHERE parent_task_id = $1
          AND NOT EXISTS (
            SELECT 1
              FROM task_threads tt
             WHERE tt.task_id = tasks.id
          )
        ORDER BY created_at ASC, id ASC`,
      [params.taskId]
    ),
    listTaskThreadCounts(params.taskId),
    getAdminSettings(),
    getTaskWorkflowOverview(params.taskId)
  ]);

  if ((taskRes.rowCount ?? 0) === 0) {
    return reply.status(404).send({ error: "Task not found" });
  }

  const debugMode = adminSettings.debugMode;
  return {
    task: {
      ...taskRes.rows[0],
      is_publicly_shared: taskRes.rows[0].public_share_id !== null,
      public_shared_at: taskRes.rows[0].public_shared_at,
      is_thread: taskRes.rows[0].is_thread,
      thread_parent_task_id: taskRes.rows[0].thread_parent_task_id,
      thread_parent_message_id: taskRes.rows[0].thread_parent_message_id,
      thread_selected_text: taskRes.rows[0].thread_selected_text,
      schedule: buildTaskScheduleResponse(taskRes.rows[0])
    },
    messages: messages.map((message) => sanitizeTaskMessageForDebugMode(message, debugMode)),
    debug_mode: debugMode,
    thread_counts: threadCounts,
    runs: runsRes.rows,
    active_leaf_message_id: activeLeafMessageId,
    subtasks: subtasksRes.rows,
    latest_context_usage: contextUsageRes.rows[0]
      ? {
          ...sanitizeContextUsagePayloadForDebugMode(contextUsageRes.rows[0].payload_json, debugMode),
          createdAt: contextUsageRes.rows[0].created_at
        }
      : null,
    workflow
  };
}

async function handleGetTaskMessageContent(request: FastifyRequest) {
  const params = taskParams.parse(request.params);
  const body = taskMessageContentBody.parse(request.body ?? {});
  await assertTaskMember(params.taskId, request.user.id);
  await ensureTaskHistoryWarm(params.taskId);

  const orderedIds = uniqueIdsPreserveOrder(body.ids);
  if (orderedIds.length === 0) {
    return { items: [] };
  }

  const [messagesRes, adminSettings] = await Promise.all([
    query<TaskMessageRow>(
      `SELECT tm.id,
              tm.role,
              tm.content_json,
              tm.message_metadata_json,
              tm.author_user_id,
              author.email AS author_email,
              author.display_name AS author_display_name,
              tm.parent_message_id,
              tm.edited_from_message_id,
              tm.created_at
         FROM unnest($2::uuid[]) WITH ORDINALITY AS req(id, ord)
         JOIN task_messages tm
           ON tm.id = req.id
          AND tm.task_id = $1
         LEFT JOIN users author ON author.id = tm.author_user_id
        ORDER BY req.ord ASC`,
      [params.taskId, orderedIds]
    ),
    getAdminSettings()
  ]);

  return {
    items: messagesRes.rows
      .map(serializeTaskMessageRow)
      .map((message) => sanitizeTaskMessageForDebugMode(message, adminSettings.debugMode))
  };
}

async function handleGetTaskConversation(request: FastifyRequest) {
  const params = taskParams.parse(request.params);
  const queryInput = taskConversationQuery.parse(request.query ?? {});
  await assertTaskMember(params.taskId, request.user.id);
  await ensureTaskHistoryWarm(params.taskId);

  const [conversation, adminSettings] = await Promise.all([
    loadTaskConversationPage({
      taskId: params.taskId,
      userId: request.user.id,
      limit: queryInput.limit,
      beforeIndex: queryInput.beforeIndex,
      afterIndex: queryInput.afterIndex,
      targetMessageId: queryInput.targetMessageId,
      requestedActiveLeafMessageId: queryInput.activeLeafMessageId
    }),
    getAdminSettings()
  ]);

  return {
    ...conversation,
    messages: conversation.messages.map((message) => sanitizeTaskMessageForDebugMode(message, adminSettings.debugMode))
  };
}

async function handleGetPublicTask(request: FastifyRequest, reply: FastifyReply) {
  const params = publicTaskShareParams.parse(request.params);
  const taskRes = await query<PublicTaskRow>(
    `SELECT t.id,
            t.title,
            t.status,
            t.source,
            t.created_at,
            t.updated_at,
            t.completed_at,
            t.parent_task_id,
            t.subtask_depth,
            t.workflow_type,
            ts.mode AS schedule_mode,
            CASE
              WHEN t.workflow_type IS NOT NULL THEN t.workflow_type
              WHEN ts.task_id IS NULL THEN 'standard'
              WHEN ts.mode = 'infinite' AND ts.run_timeout_seconds IS NOT NULL THEN 'timed'
              ELSE ts.mode
            END AS task_type,
            ts.schedule_state,
            ts.repeat_cron AS schedule_repeat_cron,
            ts.timezone AS schedule_timezone,
            ts.next_run_at AS schedule_next_run_at,
            ts.pending_run AS schedule_pending_run,
            ts.run_timeout_seconds AS schedule_run_timeout_seconds,
            ts.run_deadline_at AS schedule_run_deadline_at
       FROM tasks t
       LEFT JOIN task_schedules ts ON ts.task_id = t.id
      WHERE t.public_share_id = $1`,
    [params.shareId]
  );

  if ((taskRes.rowCount ?? 0) === 0) {
    return reply.status(404).send({ error: "Shared task not found" });
  }

  const task = taskRes.rows[0];
  await ensureTaskHistoryWarm(task.id);
  const [messagesRes, runsRes, subtasksRes, adminSettings, workflow] = await Promise.all([
    query<TaskMessageRow>(
      `SELECT tm.id,
              tm.role,
              tm.content_json,
              tm.message_metadata_json,
              tm.parent_message_id,
              tm.edited_from_message_id,
              tm.created_at
         FROM task_messages tm
        WHERE tm.task_id = $1
        ORDER BY tm.created_at ASC, tm.id ASC`,
      [task.id]
    ),
    query<TaskRunRow>(
      `SELECT id, attempt_no, started_at, ended_at, exit_reason
         FROM task_runs
        WHERE task_id = $1
        ORDER BY attempt_no DESC`,
      [task.id]
    ),
    query<SubtaskRow>(
      `SELECT id, title, status, created_at, updated_at, completed_at
         FROM tasks
        WHERE parent_task_id = $1
          AND NOT EXISTS (
            SELECT 1
              FROM task_threads tt
             WHERE tt.task_id = tasks.id
          )
        ORDER BY created_at ASC, id ASC`,
      [task.id]
    ),
    getAdminSettings(),
    getTaskWorkflowOverview(task.id)
  ]);

  const debugMode = adminSettings.debugMode;
  return {
    task: {
      id: task.id,
      title: task.title,
      status: task.status,
      source: task.source,
      created_at: task.created_at,
      updated_at: task.updated_at,
      completed_at: task.completed_at,
      parent_task_id: task.parent_task_id,
      subtask_depth: task.subtask_depth,
      task_type: task.task_type,
      is_publicly_shared: true,
      schedule: buildTaskScheduleResponse(task)
    },
    messages: messagesRes.rows
      .map(serializeTaskMessageRow)
      .map((message) => sanitizeTaskMessageForDebugMode(message, debugMode)),
    runs: runsRes.rows,
    subtasks: subtasksRes.rows,
    workflow
  };
}

async function handleGetTaskArtifacts(request: FastifyRequest) {
  const params = taskParams.parse(request.params);
  await assertTaskMember(params.taskId, request.user.id);

  const [artifactRes, canvases] = await Promise.all([
    query<{
      id: string;
      kind: string;
      relative_path: string;
      size_bytes: number | null;
      mime_type: string | null;
      created_at: string;
    }>(
      `SELECT id, kind, relative_path, size_bytes, mime_type, created_at
         FROM task_artifacts
        WHERE task_id = $1
          AND kind = 'artifact'
        ORDER BY created_at DESC
        LIMIT 500`,
      [params.taskId]
    ),
    listTaskCanvases(params.taskId)
  ]);

  return { items: artifactRes.rows, canvases };
}

function buildSearchSnippet(text: string, matchStart: number, matchLength: number, contextChars: number): {
  snippetBefore: string;
  matchText: string;
  snippetAfter: string;
} {
  const snippetStart = Math.max(0, matchStart - contextChars);
  const snippetEnd = Math.min(text.length, matchStart + matchLength + contextChars);

  return {
    snippetBefore: snippetStart > 0 ? `…${text.slice(snippetStart, matchStart)}` : text.slice(0, matchStart),
    matchText: text.slice(matchStart, matchStart + matchLength),
    snippetAfter: text.slice(matchStart + matchLength, snippetEnd) + (snippetEnd < text.length ? "…" : "")
  };
}

interface ConversationSearchMatch {
  messageId: string;
  messageIndex: number;
  matchIndex: number;
  role: string;
  createdAt: string;
  snippetBefore: string;
  matchText: string;
  snippetAfter: string;
}

function findConversationSearchMatches(
  lineageRows: TaskConversationLineageRow[],
  searchText: string
): ConversationSearchMatch[] {
  const searchLower = searchText.toLowerCase();
  const matches: ConversationSearchMatch[] = [];
  for (const row of lineageRows) {
    if (row.role === "tool") {
      continue;
    }
    const text = extractTaskSearchableText(selectConversationMessageContent(row));
    if (!text) {
      continue;
    }
    const textLower = text.toLowerCase();
    let searchFrom = 0;
    let matchIndex = 0;
    while (searchFrom < textLower.length) {
      const matchPos = textLower.indexOf(searchLower, searchFrom);
      if (matchPos < 0) {
        break;
      }
      matches.push({
        messageId: row.id,
        messageIndex: normalizeQueryInteger(row.branch_index),
        matchIndex,
        role: row.role,
        createdAt: row.created_at,
        ...buildSearchSnippet(text, matchPos, searchText.length, 80)
      });
      matchIndex += 1;
      searchFrom = matchPos + 1;
    }
  }
  return matches;
}

async function handleSearchTaskConversation(request: FastifyRequest) {
  const params = taskParams.parse(request.params);
  const queryInput = taskConversationSearchQuery.parse(request.query ?? {});
  await assertTaskMember(params.taskId, request.user.id);
  await ensureTaskHistoryWarm(params.taskId);
  const activeLeafMessageId = await resolveConversationLeafMessageId({
    taskId: params.taskId,
    userId: request.user.id,
    requestedActiveLeafMessageId: queryInput.activeLeafMessageId
  });
  if (!activeLeafMessageId) {
    return {
      items: [],
      page: queryInput.page,
      pageSize: queryInput.pageSize,
      totalItems: 0,
      totalPages: 0,
      hasNextPage: false,
      hasPreviousPage: false
    };
  }
  const lineageRows = await loadConversationLineage(params.taskId, activeLeafMessageId);
  const allMatches = findConversationSearchMatches(lineageRows, queryInput.q);
  const totalItems = allMatches.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / queryInput.pageSize));
  const page = Math.min(queryInput.page, totalPages);
  const startIdx = (page - 1) * queryInput.pageSize;
  return {
    items: allMatches.slice(startIdx, startIdx + queryInput.pageSize),
    page,
    pageSize: queryInput.pageSize,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1
  };
}

export async function registerTaskDetailRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/tasks/:taskId", { preHandler: fastify.authenticate }, handleGetTaskDetail);
  fastify.get("/api/tasks/:taskId/conversation", { preHandler: fastify.authenticate }, handleGetTaskConversation);
  fastify.get("/api/tasks/:taskId/conversation/search", { preHandler: fastify.authenticate }, handleSearchTaskConversation);
  fastify.post("/api/tasks/:taskId/messages/content", { preHandler: fastify.authenticate }, handleGetTaskMessageContent);
  fastify.get("/api/public/tasks/:shareId", handleGetPublicTask);
  fastify.get("/api/tasks/:taskId/artifacts", { preHandler: fastify.authenticate }, handleGetTaskArtifacts);
}
