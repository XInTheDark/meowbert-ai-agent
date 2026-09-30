CREATE TABLE task_conversation_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES task_messages(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('outline', 'map')),
  payload_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, kind)
);

CREATE INDEX task_conversation_snapshots_task_message_idx
  ON task_conversation_snapshots(task_id, message_id);
