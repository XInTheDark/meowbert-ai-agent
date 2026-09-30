CREATE INDEX IF NOT EXISTS idx_task_events_task_created_id
  ON task_events(task_id, created_at DESC, id DESC);
