ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS trashed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_tasks_environment_trashed_created
  ON tasks(environment_id, trashed_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_trashed_at
  ON tasks(trashed_at);

CREATE INDEX IF NOT EXISTS idx_task_messages_search
  ON task_messages
  USING GIN (to_tsvector('simple', COALESCE(content_json->>'text', content_json::text, '')));
