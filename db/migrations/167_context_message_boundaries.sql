-- A visible message freezes the history and note revisions of its private parent.
-- Revisions referenced by these boundaries remain in the existing archive/restore tables.
ALTER TABLE task_context_nodes
  ADD COLUMN snapshot_window_id uuid REFERENCES task_context_windows(id) ON DELETE SET NULL,
  ADD COLUMN snapshot_history_ordinal integer CHECK (snapshot_history_ordinal >= 0),
  ADD COLUMN snapshot_note_revision integer CHECK (snapshot_note_revision >= 0);

-- Older mutable windows have no trustworthy per-message boundary. Keep their
-- history stored, but do not expose an unbounded parent when rewinding to one.
UPDATE task_context_nodes node
   SET snapshot_window_id = context_window.id,
       snapshot_history_ordinal = 0,
       snapshot_note_revision = 0
  FROM task_context_windows context_window
 WHERE node.kind = 'visible' AND node.parent_node_id = context_window.context_node_id;

-- The latest known message can retain the current private view. Earlier
-- checkpoints cannot recover revisions already overwritten by the old writer.
-- User-message nodes may sit between that head and its private window.
WITH RECURSIVE latest_visible AS (
  SELECT DISTINCT ON (node.task_id) node.id, node.task_id, node.parent_node_id
    FROM task_context_nodes node
    JOIN task_messages message ON message.id = node.visible_message_id AND message.task_id = node.task_id
   WHERE node.kind = 'visible'
   ORDER BY node.task_id, message.created_at DESC, node.created_at DESC, node.id DESC
), head_lineage AS (
  SELECT id AS head_id, task_id, parent_node_id AS node_id, 0 AS depth FROM latest_visible
  UNION ALL
  SELECT head_lineage.head_id, head_lineage.task_id, node.parent_node_id, head_lineage.depth + 1
    FROM head_lineage
    JOIN task_context_nodes node ON node.id = head_lineage.node_id AND node.task_id = head_lineage.task_id
), current_view AS (
  SELECT DISTINCT ON (head_id) head_id, context_window.id AS window_id, context_window.context_node_id
    FROM head_lineage
    JOIN task_context_windows context_window
      ON context_window.context_node_id = head_lineage.node_id AND context_window.task_id = head_lineage.task_id
   ORDER BY head_id, depth ASC
)
UPDATE task_context_nodes node
   SET parent_node_id = current_view.context_node_id,
       snapshot_window_id = current_view.window_id,
       snapshot_history_ordinal = (SELECT COALESCE(MAX(ordinal), 0) FROM task_context_history_items WHERE window_id = current_view.window_id),
       snapshot_note_revision = (SELECT COALESCE(MAX(revision), 0) FROM task_context_notes WHERE context_node_id = current_view.context_node_id AND task_id = node.task_id)
  FROM current_view WHERE node.id = current_view.head_id;

-- Their current branch heads were not tracked either. Resume from visible
-- branch messages in a fresh window rather than replaying ambiguous private state.
UPDATE task_context_windows SET closed_at = now() WHERE closed_at IS NULL;

CREATE INDEX idx_task_context_nodes_note_boundary
  ON task_context_nodes(task_id, parent_node_id, snapshot_note_revision)
  WHERE snapshot_note_revision IS NOT NULL;
