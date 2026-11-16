ALTER TABLE task_queued_messages ADD COLUMN send_at timestamptz;
CREATE INDEX task_queued_messages_send_at_idx ON task_queued_messages (send_at, task_id) WHERE send_at IS NOT NULL;
