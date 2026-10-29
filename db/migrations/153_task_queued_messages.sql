-- Follow-ups sent while a task runs wait here until the run reaches its next model turn, so the
-- message joins the conversation without interrupting the run or breaking its prompt cache.
CREATE TABLE task_queued_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  content_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_queued_messages_task_idx ON task_queued_messages (task_id, created_at, id);
