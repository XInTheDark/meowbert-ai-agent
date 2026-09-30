CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_tasks_title_trgm
  ON tasks
  USING GIN (title gin_trgm_ops)
  WHERE title IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_messages_text_trgm
  ON task_messages
  USING GIN ((COALESCE(content_json->>'text', content_json::text, '')) gin_trgm_ops);
