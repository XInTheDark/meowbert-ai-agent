-- Branch snapshots are owned by context nodes. Older revisions within the same
-- node are never selected by note reads, so retain only the newest per path.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY task_id, context_node_id, path ORDER BY revision DESC
  ) AS position
  FROM task_context_notes
)
DELETE FROM task_context_notes note USING ranked
 WHERE note.id = ranked.id AND ranked.position > 1;
