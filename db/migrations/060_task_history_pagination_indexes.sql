CREATE INDEX IF NOT EXISTS idx_tasks_environment_root_trashed_updated
  ON tasks(environment_id, trashed_at, updated_at DESC, id DESC)
  WHERE parent_task_id IS NULL
    AND workflow_parent_task_id IS NULL;
