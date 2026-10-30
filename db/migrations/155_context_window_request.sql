ALTER TABLE task_context_windows
  ADD COLUMN IF NOT EXISTS request_state_json jsonb
    CHECK (request_state_json IS NULL OR jsonb_typeof(request_state_json) = 'object');
