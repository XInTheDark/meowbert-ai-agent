ALTER TABLE task_context_windows
  ADD COLUMN IF NOT EXISTS opening_prompt_json jsonb
    CHECK (opening_prompt_json IS NULL OR jsonb_typeof(opening_prompt_json) = 'array');
