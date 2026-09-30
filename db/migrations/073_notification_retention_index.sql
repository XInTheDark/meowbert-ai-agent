CREATE INDEX IF NOT EXISTS idx_task_events_notification_created_at
  ON task_events(created_at ASC, id ASC)
  WHERE type = 'notification';
