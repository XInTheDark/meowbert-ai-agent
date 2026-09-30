export function accessibleNodesCte(startIndex: number): string {
  return `WITH RECURSIVE context_lineage AS (
    SELECT id, parent_node_id, 0 AS depth
      FROM task_context_nodes
     WHERE id = $${startIndex}
    UNION ALL
    SELECT node.id, node.parent_node_id, context_lineage.depth + 1
      FROM task_context_nodes node
      JOIN context_lineage ON context_lineage.parent_node_id = node.id
  )`;
}

