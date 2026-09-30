CREATE TABLE IF NOT EXISTS task_threads (
  task_id uuid PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  parent_task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  parent_message_id uuid NOT NULL REFERENCES task_messages(id) ON DELETE CASCADE,
  selected_text text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_threads_parent_message
  ON task_threads(parent_task_id, parent_message_id, created_at DESC);

ALTER TABLE tasks
  DROP CONSTRAINT IF EXISTS tasks_subtask_depth_check;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_subtask_depth_check
  CHECK (subtask_depth >= 0);
