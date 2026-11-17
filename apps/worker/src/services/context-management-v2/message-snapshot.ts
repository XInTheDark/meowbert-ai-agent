import { randomUUID } from "node:crypto";
import type { ContextWindowRef } from "@meowbert/run-executor/agent/ports/run-control";
import { withTransaction } from "../../lib/db.js";

// The private node stays writable, but every message records its immutable view of it.
// Notes and history use the same locks when advancing their respective boundaries.
export async function linkVisibleContextNode(state: ContextWindowRef, visibleMessageId: string): Promise<string> {
  return withTransaction(async (client) => {
    const window = await client.query<{ context_node_id: string }>(
      "SELECT context_node_id FROM task_context_windows WHERE id = $1 AND task_id = $2 FOR UPDATE", [state.windowId, state.taskId]);
    if (!window.rows[0]) throw new Error("Context window does not belong to this task.");
    const contextNodeId = window.rows[0].context_node_id;
    await client.query("SELECT id FROM task_context_nodes WHERE id = $1 AND task_id = $2 FOR UPDATE", [contextNodeId, state.taskId]);
    const existing = await client.query<{ id: string; snapshot_window_id: string | null }>(
      "SELECT id, snapshot_window_id FROM task_context_nodes WHERE task_id = $1 AND visible_message_id = $2",
      [state.taskId, visibleMessageId]
    );
    if (existing.rows[0]?.snapshot_window_id) return existing.rows[0].id;
    const nodeId = existing.rows[0]?.id ?? randomUUID();
    await client.query(
      `INSERT INTO task_context_nodes (id, task_id, parent_node_id, visible_message_id, kind,
         snapshot_window_id, snapshot_history_ordinal, snapshot_note_revision)
       SELECT $1, $2, $3, $4, 'visible', $5,
              (SELECT COALESCE(MAX(ordinal), 0) FROM task_context_history_items WHERE window_id = $5),
              (SELECT COALESCE(MAX(revision), 0) FROM task_context_notes WHERE task_id = $2 AND context_node_id = $3)
       ON CONFLICT (id) DO UPDATE SET parent_node_id = EXCLUDED.parent_node_id,
         snapshot_window_id = EXCLUDED.snapshot_window_id,
         snapshot_history_ordinal = EXCLUDED.snapshot_history_ordinal,
         snapshot_note_revision = EXCLUDED.snapshot_note_revision`,
      [nodeId, state.taskId, contextNodeId, visibleMessageId, state.windowId]
    );
    await client.query("UPDATE task_context_windows SET branch_leaf_message_id = $2 WHERE id = $1", [state.windowId, visibleMessageId]);
    return nodeId;
  });
}
