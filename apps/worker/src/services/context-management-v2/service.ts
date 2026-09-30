import { randomUUID } from "node:crypto";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { query, withTransaction } from "../../lib/db.js";
import { buildContextWindowPrompt, buildThreadHint } from "./prompts.js";
import { mergeContextSeedItems } from "./history.js";
import type {
  ContextHistoryRow,
  ContextManagementState,
  ContextManagementV2State,
  ContextNoteRow,
  ContextWindowRow
} from "./types.js";

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

function addOpaqueItemMarker(item: ResponseInputItem, id: string): void {
  const record = getRecord(item);
  if (record.role !== "user" && record.role !== "system" && record.role !== "developer") return;
  const marker = `[id: ${id}]`;
  for (const field of ["content", "output"] as const) {
    const value = record[field];
    if (typeof value !== "string" || value.includes(marker)) continue;
    record[field] = `${value}\n${marker}`;
    return;
  }
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


async function loadNotesHint(taskId: string, contextNodeId: string): Promise<string | null> {
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
  const continuity = result.rows.find((note) => note.path === "continuity.md")?.content ?? null;
  return buildThreadHint({
    continuity,
    index: result.rows.map((note) => ({
      path: note.path,
      size: Buffer.byteLength(note.content, "utf8"),
      updatedAt: note.updated_at
    }))
  });
}

export async function resolveContextManagementState(input: {
  taskId: string;
  requestedVersion: "v1" | "v2";
  runtimeModel: string;
  branchLeafMessageId: string | null;
  seedItems: ResponseInputItem[];
  skipHistoryReplay?: boolean;
}): Promise<{ state: ContextManagementState; conversationItems: ResponseInputItem[] }> {
  const version = await resolveFrozenContextManagementVersion(input);

  if (version !== "v2") {
    return { state: { version: "v1" }, conversationItems: input.seedItems };
  }

  const visibleNodeId = await resolveVisibleContextNode(input.taskId, input.branchLeafMessageId);
  const latest = await query<ContextWindowRow>(
    `${accessibleNodesCte(2)}
     SELECT context_window.id, context_window.context_node_id, context_window.parent_window_id, context_window.branch_leaf_message_id, context_window.ordinal
       FROM task_context_windows context_window
       JOIN context_lineage ON context_lineage.id = context_window.context_node_id
      WHERE context_window.task_id = $1 AND context_window.closed_at IS NULL
      ORDER BY context_window.ordinal DESC
      LIMIT 1`,
    [input.taskId, visibleNodeId]
  );
  const contextNodeId = latest.rows[0]?.context_node_id ?? await createPrivateContextNode(input.taskId, visibleNodeId);
  const window = latest.rows[0] ?? await createWindow({
    taskId: input.taskId,
    parentWindowId: null,
    contextNodeId,
    branchLeafMessageId: input.branchLeafMessageId,
    reason: "initial"
  });
  const first = await query<{ id: string }>(
    "SELECT id FROM task_context_windows WHERE task_id = $1 ORDER BY ordinal ASC LIMIT 1",
    [input.taskId]
  );
  const state: ContextManagementV2State = {
    version: "v2",
    taskId: input.taskId,
    firstWindowId: first.rows[0]?.id ?? window.id,
    windowId: window.id,
    contextNodeId: window.context_node_id,
    previousWindowId: window.parent_window_id,
    branchLeafMessageId: input.branchLeafMessageId,
    reminderSent: false,
    pendingReset: false,
    recoveryPhase: "normal"
  };
  if (input.skipHistoryReplay) {
    return { state, conversationItems: [] };
  }
  const existing = await loadWindowItems(state.windowId);
  const merged = mergeContextSeedItems(existing, input.seedItems);
  if (merged.newItems.length > 0) {
    await recordContextItems(state, merged.newItems);
  }
  return { state, conversationItems: merged.conversationItems };
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

export async function loadWindowItems(windowId: string): Promise<ResponseInputItem[]> {
  const result = await query<ContextHistoryRow>(
    `SELECT id, ordinal, role, item_type, tool_namespace, tool_name, payload_json, created_at
       FROM task_context_history_items
      WHERE window_id = $1
      ORDER BY ordinal ASC`,
    [windowId]
  );
  return result.rows.map((row) => row.payload_json);
}

export async function recordContextItems(state: ContextManagementV2State, items: ResponseInputItem[]): Promise<void> {
  if (items.length === 0) return;
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
        `INSERT INTO task_context_history_items (id, task_id, window_id, context_node_id, ordinal, role, item_type, tool_namespace, tool_name, payload_json)
         SELECT item.id::uuid, $1::uuid, $2::uuid, $3::uuid, item.ordinal, item.role, item.item_type, item.tool_namespace, item.tool_name, item.payload_json
           FROM jsonb_to_recordset($4::jsonb) AS item(id text, ordinal integer, role text, item_type text, tool_namespace text, tool_name text, payload_json jsonb)`,
        [state.taskId, state.windowId, state.contextNodeId, `[${batch.join(",")}]`]
      );
      batch = [];
      batchBytes = 2;
    };
    for (const item of items) {
      ordinal += 1;
      const id = randomUUID();
      addOpaqueItemMarker(item, id);
      const metadata = getHistoryMetadata(item);
      const row = JSON.stringify({
        id,
        ordinal,
        role: metadata.role,
        item_type: metadata.itemType,
        tool_namespace: metadata.toolNamespace,
        tool_name: metadata.toolName,
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

export async function buildV2WindowDeveloperItems(input: {
  state: ContextManagementV2State;
  agentName: string;
}): Promise<ResponseInputItem[]> {
  const hint = await loadNotesHint(input.state.taskId, input.state.contextNodeId);
  return [{ role: "developer", content: buildContextWindowPrompt({ state: input.state, agentName: input.agentName, threadHint: hint }) }];
}

export async function startNewContextWindow(input: {
  state: ContextManagementV2State;
  branchLeafMessageId: string | null;
  reason: string;
}): Promise<ContextManagementV2State> {
  await query("UPDATE task_context_windows SET closed_at = now() WHERE id = $1 AND closed_at IS NULL", [input.state.windowId]);
  const contextNodeId = await createPrivateContextNode(input.state.taskId, input.state.contextNodeId);
  const window = await createWindow({
    taskId: input.state.taskId,
    parentWindowId: input.state.windowId,
    contextNodeId,
    branchLeafMessageId: input.branchLeafMessageId,
    reason: input.reason
  });
  return {
    ...input.state,
    windowId: window.id,
    contextNodeId: window.context_node_id,
    previousWindowId: input.state.windowId,
    branchLeafMessageId: input.branchLeafMessageId,
    reminderSent: false,
    pendingReset: false,
    recoveryPhase: "normal"
  };
}

export async function linkContextNodeToVisibleMessage(input: {
  state: ContextManagementV2State;
  visibleMessageId: string;
}): Promise<ContextManagementV2State> {
  const existing = await query<{ id: string }>(
    "SELECT id FROM task_context_nodes WHERE task_id = $1 AND visible_message_id = $2 LIMIT 1",
    [input.state.taskId, input.visibleMessageId]
  );
  if (existing.rows[0]) return { ...input.state, contextNodeId: existing.rows[0].id };
  const nodeId = randomUUID();
  await query(
    `INSERT INTO task_context_nodes (id, task_id, parent_node_id, visible_message_id, kind)
     VALUES ($1, $2, $3, $4, 'visible')`,
    [nodeId, input.state.taskId, input.state.contextNodeId, input.visibleMessageId]
  );
  return { ...input.state, contextNodeId: nodeId };
}
