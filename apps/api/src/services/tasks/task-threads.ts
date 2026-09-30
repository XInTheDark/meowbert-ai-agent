import { cloneConversationSnapshots } from "@meowbert/shared";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { createTaskMessageMetadata } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { listTaskMessageLineageIds } from "./task-message-lineage.js";
import {
  buildUserMessageContent,
  enqueueRun,
  setTaskBranchSelection,
  type TaskMessageAttachment,
  type TaskMessageAgentSelection,
  type TaskMessageToolOptions
} from "./task-service/index.js";
import type { ProjectCanvasIntent } from "../canvases/project-canvases.js";

interface ParentTaskRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  default_timezone: string;
  subtask_depth: number;
  task_root_path: string;
  interactive_canvas_id: string | null;
  interactive_canvas_intent: ProjectCanvasIntent | null;
}

interface SourceMessageRow {
  id: string;
  role: string;
  content_json: Record<string, unknown>;
  message_metadata_json: Record<string, unknown> | null;
  token_usage_json: Record<string, unknown> | null;
  source_ref: string | null;
  author_user_id: string | null;
  parent_message_id: string | null;
  edited_from_message_id: string | null;
  created_at: string;
}

interface ThreadCountRow {
  parent_message_id: string;
  count: number;
}

interface ThreadSummaryRow {
  task_id: string;
  parent_message_id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  selected_text: string | null;
  selected_text_location: string | null;
  latest_assistant_preview: string | null;
}

export interface TaskThreadCount {
  parent_message_id: string;
  count: number;
}

export interface TaskThreadSummary {
  task_id: string;
  parent_message_id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  selected_text: string | null;
  selected_text_location: string | null;
  latest_assistant_preview: string | null;
}

function buildThreadRootPath(parentTaskRootPath: string, taskId: string): string {
  const normalizedParent = parentTaskRootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  return `${normalizedParent}/threads/${taskId}`;
}

function normalizeSelectedText(selectedText: string | null | undefined): string | null {
  if (typeof selectedText !== "string") {
    return null;
  }

  const normalized = selectedText.trim();
  return normalized.length > 0 ? normalized : null;
}

function quoteSelectedText(selectedText: string): string {
  return selectedText
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

function buildThreadInitialMessageText(
  message: string,
  selectedText: string | null,
  selectedTextLocation: string | null
): string {
  if (!selectedText) {
    return message;
  }

  return [
    selectedTextLocation
      ? `About this selected snippet (${selectedTextLocation}):`
      : "About this selected snippet:",
    quoteSelectedText(selectedText),
    "",
    message
  ].join("\n");
}

async function loadParentTaskOrThrow(client: PoolClient, taskId: string): Promise<ParentTaskRow> {
  const taskRes = await client.query<ParentTaskRow>(
    `SELECT id,
            workspace_id,
            environment_id,
            default_timezone,
            subtask_depth,
            task_root_path,
            interactive_canvas_id,
            interactive_canvas_intent
       FROM tasks
      WHERE id = $1`,
    [taskId]
  );

  if ((taskRes.rowCount ?? 0) === 0) {
    throw new Error("Task not found");
  }

  return taskRes.rows[0];
}

async function loadOrderedSourceMessages(
  client: PoolClient,
  sourceTaskId: string,
  lineageMessageIds: string[]
): Promise<SourceMessageRow[]> {
  const sourceMessagesRes = await client.query<SourceMessageRow>(
    `SELECT id,
            role,
            content_json,
            message_metadata_json,
            token_usage_json,
            source_ref,
            author_user_id,
            parent_message_id,
            edited_from_message_id,
            created_at
       FROM task_messages
      WHERE task_id = $1
        AND id = ANY($2::uuid[])`,
    [sourceTaskId, lineageMessageIds]
  );

  const byId = new Map(sourceMessagesRes.rows.map((row) => [row.id, row]));
  return lineageMessageIds
    .map((messageId) => byId.get(messageId) ?? null)
    .filter((row): row is SourceMessageRow => row !== null);
}

async function cloneLineageMessages(client: PoolClient, input: {
  taskId: string;
  sourceTaskId: string;
  sourceMessages: SourceMessageRow[];
  createdAtBase: number;
}): Promise<Map<string, string>> {
  const idMap = new Map<string, string>();

  for (let index = 0; index < input.sourceMessages.length; index += 1) {
    const sourceMessage = input.sourceMessages[index];
    const parentMessageId = sourceMessage.parent_message_id
      ? (idMap.get(sourceMessage.parent_message_id) ?? null)
      : null;
    const editedFromMessageId = sourceMessage.edited_from_message_id
      ? (idMap.get(sourceMessage.edited_from_message_id) ?? null)
      : null;
    const createdAt = new Date(input.createdAtBase + index).toISOString();
    const messageMetadata = sourceMessage.role === "tool"
      ? null
      : (sourceMessage.message_metadata_json ?? createTaskMessageMetadata(sourceMessage.created_at));

    const insertedMessage = await client.query<{ id: string }>(
      `INSERT INTO task_messages (
        task_id,
        role,
        content_json,
        message_metadata_json,
        token_usage_json,
        source_ref,
        author_user_id,
        parent_message_id,
        edited_from_message_id,
        created_at
      )
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        input.taskId,
        sourceMessage.role,
        JSON.stringify(sourceMessage.content_json),
        messageMetadata ? JSON.stringify(messageMetadata) : null,
        sourceMessage.token_usage_json ? JSON.stringify(sourceMessage.token_usage_json) : null,
        sourceMessage.source_ref,
        sourceMessage.author_user_id,
        parentMessageId,
        editedFromMessageId,
        createdAt
      ]
    );

    idMap.set(sourceMessage.id, insertedMessage.rows[0].id);
  }

  if (input.sourceMessages.length) {
    await cloneConversationSnapshots(client, {
      sourceTaskId: input.sourceTaskId, sourceLeafId: input.sourceMessages[input.sourceMessages.length - 1].id,
      targetTaskId: input.taskId, ids: idMap
    });
  }
  return idMap;
}

export async function listTaskThreadCounts(parentTaskId: string): Promise<TaskThreadCount[]> {
  const countsRes = await query<ThreadCountRow>(
    `SELECT parent_message_id, COUNT(*)::int AS count
       FROM task_threads
      WHERE parent_task_id = $1
      GROUP BY parent_message_id`,
    [parentTaskId]
  );

  return countsRes.rows;
}

export async function listTaskThreads(input: {
  parentTaskId: string;
  parentMessageId: string;
}): Promise<TaskThreadSummary[]> {
  const threadsRes = await query<ThreadSummaryRow>(
    `SELECT tt.task_id,
            tt.parent_message_id,
            t.title,
            t.status,
            t.created_at,
            t.updated_at,
            tt.selected_text,
            tt.selected_text_location,
            COALESCE(
              latest_assistant.content_json->>'text',
              latest_assistant.content_json::text,
              ''
            ) AS latest_assistant_preview
       FROM task_threads tt
       JOIN tasks t
         ON t.id = tt.task_id
       LEFT JOIN LATERAL (
         SELECT tm.content_json
           FROM task_messages tm
          WHERE tm.task_id = tt.task_id
            AND tm.role = 'assistant'
          ORDER BY tm.created_at DESC, tm.id DESC
          LIMIT 1
       ) latest_assistant ON true
      WHERE tt.parent_task_id = $1
        AND tt.parent_message_id = $2
      ORDER BY t.updated_at DESC, t.id DESC`,
    [input.parentTaskId, input.parentMessageId]
  );

  return threadsRes.rows;
}

export async function createThreadTask(input: {
  taskId?: string;
  parentTaskId: string;
  parentMessageId: string;
  userId: string;
  message: string;
  attachments?: TaskMessageAttachment[];
  selectedText?: string | null;
  selectedTextLocation?: string | null;
  tools?: TaskMessageToolOptions;
  agent?: TaskMessageAgentSelection;
  interactiveCanvasId?: string | null;
  interactiveCanvasIntent?: ProjectCanvasIntent | null;
}): Promise<{
  taskId: string;
  messageId: string;
  activeLeafMessageId: string;
  runId: string;
  attemptNo: number;
}> {
  const lineageMessageIds = await listTaskMessageLineageIds(input.parentTaskId, input.parentMessageId);
  if (lineageMessageIds.length === 0) {
    throw new Error("Message not found");
  }

  const taskId = input.taskId ?? randomUUID();
  const selectedText = normalizeSelectedText(input.selectedText);
  const selectedTextLocation = normalizeSelectedText(input.selectedTextLocation);
  const initialMessageText = buildThreadInitialMessageText(input.message, selectedText, selectedTextLocation);

  const prepared = await withTransaction(async (client) => {
    const anchorMessageRes = await client.query<{ role: string }>(
      `SELECT role
         FROM task_messages
        WHERE task_id = $1
          AND id = $2`,
      [input.parentTaskId, input.parentMessageId]
    );

    if ((anchorMessageRes.rowCount ?? 0) === 0) {
      throw new Error("Message not found");
    }
    if (anchorMessageRes.rows[0].role !== "assistant") {
      throw new Error("Threads can only start from assistant messages");
    }

    const parentTask = await loadParentTaskOrThrow(client, input.parentTaskId);
    const sourceMessages = await loadOrderedSourceMessages(client, input.parentTaskId, lineageMessageIds);
    const createdAtBase = Date.now();
    const taskRootPath = buildThreadRootPath(parentTask.task_root_path, taskId);

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
        parent_task_id,
        subtask_depth,
        task_root_path,
        interactive_canvas_id,
        interactive_canvas_intent
      )
      VALUES ($1, $2, $3, NULL, 'queued', 'web', $4, $5, $6, $7, $8, $9, $10)`,
      [
        taskId,
        parentTask.workspace_id,
        parentTask.environment_id,
        input.userId,
        parentTask.default_timezone,
        input.parentTaskId,
        parentTask.subtask_depth + 1,
        taskRootPath,
        input.interactiveCanvasId ?? parentTask.interactive_canvas_id,
        input.interactiveCanvasIntent ?? (input.interactiveCanvasId ? "update" : parentTask.interactive_canvas_intent)
      ]
    );

    await client.query(
      `INSERT INTO task_threads (
        task_id,
        parent_task_id,
        parent_message_id,
        selected_text,
        selected_text_location,
        agent_id,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        taskId,
        input.parentTaskId,
        input.parentMessageId,
        selectedText,
        selectedTextLocation,
        input.agent?.id ?? null,
        input.userId
      ]
    );

    const idMap = await cloneLineageMessages(client, {
      sourceTaskId: input.parentTaskId,
      taskId,
      sourceMessages,
      createdAtBase
    });
    const clonedAnchorMessageId = idMap.get(input.parentMessageId);
    if (!clonedAnchorMessageId) {
      throw new Error("Failed to clone thread anchor message");
    }

    const insertedMessage = await client.query<{ id: string }>(
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
      RETURNING id`,
      [
        taskId,
        JSON.stringify(
          buildUserMessageContent({
            message: initialMessageText,
            attachments: input.attachments,
            tools: input.tools,
            agent: input.agent
          })
        ),
        JSON.stringify(createTaskMessageMetadata(new Date(createdAtBase + sourceMessages.length).toISOString())),
        input.userId,
        clonedAnchorMessageId,
        new Date(createdAtBase + sourceMessages.length).toISOString()
      ]
    );
    const messageId = insertedMessage.rows[0].id;

    await setTaskBranchSelection({
      taskId,
      userId: input.userId,
      activeLeafMessageId: messageId,
      client
    });

    return {
      taskId,
      messageId,
      activeLeafMessageId: messageId,
      workspaceId: parentTask.workspace_id,
      environmentId: parentTask.environment_id
    };
  });

  const run = await enqueueRun({
    taskId: prepared.taskId,
    workspaceId: prepared.workspaceId,
    environmentId: prepared.environmentId,
    triggerSource: "web",
    branchMessageId: prepared.messageId,
    selectionUserId: input.userId
  });

  return {
    taskId: prepared.taskId,
    messageId: prepared.messageId,
    activeLeafMessageId: prepared.activeLeafMessageId,
    runId: run.runId,
    attemptNo: run.attemptNo
  };
}
