CREATE OR REPLACE FUNCTION enqueue_task_search_sync(target_task_id uuid, sync_reason text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF target_task_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO task_search_sync_queue (task_id, reason, queued_at, locked_at, last_error)
  VALUES (target_task_id, COALESCE(sync_reason, 'changed'), now(), NULL, NULL)
  ON CONFLICT (task_id) DO UPDATE
    SET reason = EXCLUDED.reason,
        queued_at = now(),
        locked_at = NULL,
        attempts = 0,
        last_error = NULL;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_task_search_sync_for_folder_subtree(target_folder_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF target_folder_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO task_search_sync_queue (task_id, reason, queued_at, locked_at, last_error)
  WITH RECURSIVE folder_scope(id) AS (
      SELECT target_folder_id
      UNION ALL
      SELECT child.id
        FROM task_folders child
        JOIN folder_scope fs ON fs.id = child.parent_folder_id
    )
    SELECT t.id, 'folder_changed', now(), NULL, NULL
      FROM tasks t
     WHERE t.folder_id IN (SELECT id FROM folder_scope)
  ON CONFLICT (task_id) DO UPDATE
    SET reason = EXCLUDED.reason,
        queued_at = now(),
        locked_at = NULL,
        attempts = 0,
        last_error = NULL;
END;
$$;

DROP INDEX IF EXISTS idx_task_messages_search;
