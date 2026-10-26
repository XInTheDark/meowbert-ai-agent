import { randomUUID } from "node:crypto";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { query, withTransaction } from "../../lib/db.js";
import type {
  ContextHistoryRecord,
  ContextNotesSummary,
  ContextWindowRef,
  OpenedContextWindow
} from "@meowbert/run-executor/agent/ports/run-control";
import type { ContextHistoryRow, ContextNoteRow, ContextWindowRow } from "@meowbert/run-executor/context-management-v2/types";

import { accessibleNodesCte } from "./lineage.js";
export { accessibleNodesCte } from "./lineage.js";
export { writeContextNote } from "./notes.js";

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function getHistoryMetadata(item: ResponseInputItem): {
  role: string;
  itemType: string | null;
  toolNamespace: string | null;
  toolName: string | null;
} {
  const record = getRecord(item);
  const type = typeof record.type === "string" ? record.type : null;
  const name = typeof record.name === "string" ? record.name : null;
  const [toolNamespace, toolName] = name?.includes(".") ? name.split(".", 2) : [null, name];
  return {
    role: typeof record.role === "string" ? record.role : (type?.endsWith("_output") ? "tool" : "assistant"),
    itemType: type,
    toolNamespace,
    toolName
  };
}

async function createWindow(input: {
  taskId: string;
  parentWindowId: string | null;
  contextNodeId: string;
  branchLeafMessageId: string | null;
  reason: string;
}): Promise<ContextWindowRow> {
  const result = await query<ContextWindowRow>(
    `WITH next_ordinal AS (
       SELECT COALESCE(MAX(ordinal), 0) + 1 AS ordinal
         FROM task_context_windows
        WHERE task_id = $1
     )
     INSERT INTO task_context_windows (id, task_id, parent_window_id, context_node_id, branch_leaf_message_id, ordinal, opened_reason)
     SELECT $2, $1, $3, $4, $5, next_ordinal.ordinal, $6
       FROM next_ordinal
     RETURNING id, context_node_id, parent_window_id, branch_leaf_message_id, ordinal`,
    [input.taskId, randomUUID(), input.parentWindowId, input.contextNodeId, input.branchLeafMessageId, input.reason]
  );
  return result.rows[0];
}

async function createPrivateContextNode(taskId: string, parentNodeId: string | null): Promise<string> {
  const id = randomUUID();
  await query(
    `INSERT INTO task_context_nodes (id, task_id, parent_node_id, kind)
     VALUES ($1, $2, $3, 'private')`,
    [id, taskId, parentNodeId]
  );
  return id;
}

async function resolveVisibleContextNode(taskId: string, visibleMessageId: string | null): Promise<string> {
  const existing = await query<{ id: string }>(
    `SELECT id
       FROM task_context_nodes
      WHERE task_id = $1
        AND visible_message_id IS NOT DISTINCT FROM $2
      ORDER BY created_at ASC
      LIMIT 1`,
    [taskId, visibleMessageId]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const parent = visibleMessageId
    ? await query<{ id: string }>(
      `WITH RECURSIVE message_lineage AS (
         SELECT id, parent_message_id, 0 AS depth
           FROM task_messages
          WHERE task_id = $1 AND id = $2
         UNION ALL
         SELECT message.id, message.parent_message_id, message_lineage.depth + 1
           FROM task_messages message
           JOIN message_lineage ON message_lineage.parent_message_id = message.id
          WHERE message.task_id = $1
       )
       SELECT node.id
         FROM message_lineage
         JOIN task_context_nodes node
           ON node.task_id = $1 AND node.visible_message_id = message_lineage.id
        WHERE message_lineage.depth > 0
        ORDER BY message_lineage.depth ASC
        LIMIT 1`,
      [taskId, visibleMessageId]
    )
    : { rows: [] };
  const id = randomUUID();
  await query(
    `INSERT INTO task_context_nodes (id, task_id, parent_node_id, visible_message_id, kind)
     VALUES ($1, $2, $3, $4, 'visible')`,
    [id, taskId, parent.rows[0]?.id ?? null, visibleMessageId]
  );
  return id;
}


export async function loadContextNotesSummary(taskId: string, contextNodeId: string): Promise<ContextNotesSummary> {
  const result = await query<ContextNoteRow>(
    `${accessibleNodesCte(2)}, effective_notes AS (
       SELECT DISTINCT ON (note.path) note.path, note.content, note.created_at, note.updated_at
         FROM task_context_notes note
         JOIN context_lineage ON context_lineage.id = note.context_node_id
        WHERE note.task_id = $1
        ORDER BY note.path, context_lineage.depth ASC, note.revision DESC
     )
     SELECT path, content, created_at, updated_at
       FROM effective_notes
      ORDER BY updated_at DESC, path ASC
      LIMIT 50`,
    [taskId, contextNodeId]
  );
  return {
    continuity: result.rows.find((note) => note.path === "continuity.md")?.content ?? null,
    index: result.rows.map((note) => ({
      path: note.path,
      size: Buffer.byteLength(note.content, "utf8"),
      updatedAt: note.updated_at
    }))
  };
}

// The open window on the branch ending at `branchLeafMessageId`, created when it has none.
export async function openContextWindow(taskId: string, branchLeafMessageId: string | null): Promise<OpenedContextWindow> {
  const visibleNodeId = await resolveVisibleContextNode(taskId, branchLeafMessageId);
  const latest = await query<ContextWindowRow>(
    `${accessibleNodesCte(2)}
     SELECT context_window.id, context_window.context_node_id, context_window.parent_window_id, context_window.branch_leaf_message_id, context_window.ordinal
       FROM task_context_windows context_window
       JOIN context_lineage ON context_lineage.id = context_window.context_node_id
      WHERE context_window.task_id = $1 AND context_window.closed_at IS NULL
      ORDER BY context_window.ordinal DESC
      LIMIT 1`,
    [taskId, visibleNodeId]
  );
  const contextNodeId = latest.rows[0]?.context_node_id ?? await createPrivateContextNode(taskId, visibleNodeId);
  const window = latest.rows[0] ?? await createWindow({
    taskId,
    parentWindowId: null,
    contextNodeId,
    branchLeafMessageId,
    reason: "initial"
  });
  const first = await query<{ id: string }>(
    "SELECT id FROM task_context_windows WHERE task_id = $1 ORDER BY ordinal ASC LIMIT 1",
    [taskId]
  );
  return {
    firstWindowId: first.rows[0]?.id ?? window.id,
    windowId: window.id,
    contextNodeId: window.context_node_id,
    previousWindowId: window.parent_window_id
  };
}

export async function resolveFrozenContextManagementVersion(input: {
  taskId: string;
  requestedVersion: "v1" | "v2";
  runtimeModel: string;
}): Promise<"v1" | "v2"> {
  const session = await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO task_context_sessions (task_id, version, first_model)
       VALUES ($1, $2, $3)
       ON CONFLICT (task_id) DO NOTHING`,
      [input.taskId, input.requestedVersion, input.runtimeModel]
    );
    const result = await client.query<{ version: "v1" | "v2" }>(
      "SELECT version FROM task_context_sessions WHERE task_id = $1 FOR UPDATE",
      [input.taskId]
    );
    return result.rows[0];
  });
  return session?.version ?? input.requestedVersion;
}

export async function loadWindowItems(taskId: string, windowId: string): Promise<ResponseInputItem[]> {
  const result = await query<ContextHistoryRow>(
    `SELECT id, ordinal, role, item_type, tool_namespace, tool_name, payload_json, created_at
       FROM task_context_history_items
      WHERE window_id = $1 AND task_id = $2
      ORDER BY ordinal ASC`,
    [windowId, taskId]
  );
  return result.rows.map((row) => row.payload_json);
}

export async function loadLastCallNumber(taskId: string): Promise<number> {
  const result = await query<{ call_number: number | null }>(
    "SELECT MAX(call_number) AS call_number FROM task_context_history_items WHERE task_id = $1",
    [taskId]
  );
  return result.rows[0]?.call_number ?? 0;
}

export async function recordContextHistoryRecords(
  state: ContextWindowRef,
  records: ContextHistoryRecord[]
): Promise<void> {
  if (records.length === 0) return;
  await withTransaction(async (client) => {
    await client.query<{ id: string }>(
      `SELECT id FROM task_context_windows WHERE id = $1 FOR UPDATE`,
      [state.windowId]
    );
    const ordinalResult = await client.query<{ ordinal: number }>(
      "SELECT COALESCE(MAX(ordinal), 0) AS ordinal FROM task_context_history_items WHERE window_id = $1",
      [state.windowId]
    );
    let ordinal = ordinalResult.rows[0]?.ordinal ?? 0;
    let batch: string[] = [];
    let batchBytes = 2;
    const flushBatch = async (): Promise<void> => {
      if (batch.length === 0) return;
      await client.query(
        `INSERT INTO task_context_history_items (id, task_id, window_id, context_node_id, ordinal, role, item_type, tool_namespace, tool_name, call_number, payload_json)
         SELECT item.id::uuid, $1::uuid, $2::uuid, $3::uuid, item.ordinal, item.role, item.item_type, item.tool_namespace, item.tool_name, item.call_number, item.payload_json
           FROM jsonb_to_recordset($4::jsonb) AS item(id text, ordinal integer, role text, item_type text, tool_namespace text, tool_name text, call_number integer, payload_json jsonb)`,
        [state.taskId, state.windowId, state.contextNodeId, `[${batch.join(",")}]`]
      );
      batch = [];
      batchBytes = 2;
    };
    for (const { id, item, callNumber } of records) {
      ordinal += 1;
      const metadata = getHistoryMetadata(item);
      const row = JSON.stringify({
        id,
        ordinal,
        role: metadata.role,
        item_type: metadata.itemType,
        tool_namespace: metadata.toolNamespace,
        tool_name: metadata.toolName,
        call_number: callNumber ?? null,
        payload_json: item
      });
      const rowBytes = Buffer.byteLength(row, "utf8") + (batch.length > 0 ? 1 : 0);
      if (batch.length >= 128 || (batch.length > 0 && batchBytes + rowBytes > 2_000_000)) {
        await flushBatch();
      }
      batch.push(row);
      batchBytes += rowBytes;
    }
    await flushBatch();
  });
}

export async function startNewContextWindowRecord(
  state: ContextWindowRef,
  branchLeafMessageId: string | null,
  reason: string
): Promise<{ windowId: string; contextNodeId: string }> {
  await query("UPDATE task_context_windows SET closed_at = now() WHERE id = $1 AND closed_at IS NULL", [state.windowId]);
  const contextNodeId = await createPrivateContextNode(state.taskId, state.contextNodeId);
  const window = await createWindow({
    taskId: state.taskId,
    parentWindowId: state.windowId,
    contextNodeId,
    branchLeafMessageId,
    reason
  });
  return { windowId: window.id, contextNodeId: window.context_node_id };
}

// The visible context node for a message, created under the window's node when it has none.
// Throws unless the window and its context node both belong to the task.
export async function assertContextWindowOfTask(state: ContextWindowRef): Promise<void> {
  const result = await query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM task_context_windows WHERE id = $1 AND task_id = $3)
        AND EXISTS (SELECT 1 FROM task_context_nodes WHERE id = $2 AND task_id = $3) AS ok`,
    [state.windowId, state.contextNodeId, state.taskId]
  );
  if (result.rows[0]?.ok !== true) {
    throw new Error("Context window does not belong to this task.");
  }
}

export async function linkVisibleContextNode(state: ContextWindowRef, visibleMessageId: string): Promise<string> {
  const existing = await query<{ id: string }>(
    "SELECT id FROM task_context_nodes WHERE task_id = $1 AND visible_message_id = $2 LIMIT 1",
    [state.taskId, visibleMessageId]
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const nodeId = randomUUID();
  await query(
    `INSERT INTO task_context_nodes (id, task_id, parent_node_id, visible_message_id, kind)
     VALUES ($1, $2, $3, $4, 'visible')`,
    [nodeId, state.taskId, state.contextNodeId, visibleMessageId]
  );
  return nodeId;
}
