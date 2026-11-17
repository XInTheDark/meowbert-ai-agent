export function accessibleNodesCte(startIndex: number): string {
  return `WITH RECURSIVE context_lineage AS (
    SELECT id, parent_node_id, visible_message_id, snapshot_window_id,
           snapshot_history_ordinal, snapshot_note_revision, 0 AS depth,
           NULL::integer AS history_limit, NULL::integer AS note_revision_limit
      FROM task_context_nodes
     WHERE id = $${startIndex}
    UNION ALL
    SELECT node.id, node.parent_node_id, node.visible_message_id, node.snapshot_window_id,
           node.snapshot_history_ordinal, node.snapshot_note_revision, context_lineage.depth + 1,
           context_lineage.snapshot_history_ordinal, context_lineage.snapshot_note_revision
      FROM task_context_nodes node
      JOIN context_lineage ON context_lineage.parent_node_id = node.id
  )`;
}

