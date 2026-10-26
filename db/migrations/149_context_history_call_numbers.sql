-- The task-wide number shown to the model on each tool call and its output, so context edits and
-- history lookups can name calls without provider call ids.
ALTER TABLE task_context_history_items ADD COLUMN IF NOT EXISTS call_number integer;

CREATE INDEX IF NOT EXISTS idx_task_context_history_task_call_number
  ON task_context_history_items(task_id, call_number)
  WHERE call_number IS NOT NULL;
