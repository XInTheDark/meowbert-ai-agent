ALTER TABLE task_threads
  ADD COLUMN IF NOT EXISTS agent_id text;
