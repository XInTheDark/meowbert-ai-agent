ALTER TABLE task_message_model_routes
  ADD COLUMN IF NOT EXISTS quick_mode boolean NOT NULL DEFAULT false;
