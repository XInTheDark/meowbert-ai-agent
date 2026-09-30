DROP INDEX IF EXISTS idx_tasks_task_history_archive_candidates;

CREATE INDEX IF NOT EXISTS idx_tasks_task_history_archive_candidates
  ON tasks(
    GREATEST(task_history_last_active_at, COALESCE(task_history_last_warmed_at, to_timestamp(0))) ASC,
    task_history_last_active_at ASC,
    id ASC
  )
  WHERE task_history_state = 'warm'
    AND task_history_archive_failed_attempts < 3
    AND status NOT IN ('queued', 'starting', 'running');

CREATE INDEX IF NOT EXISTS idx_task_messages_task_created_id_archive
  ON task_messages(task_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_task_events_task_created_id_archive
  ON task_events(task_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_task_message_revisions_task_created_id_archive
  ON task_message_revisions(task_id, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_task_workflow_messages_task_no_id_archive
  ON task_workflow_messages(workflow_task_id, message_no ASC, id ASC);
