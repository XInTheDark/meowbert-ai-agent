-- The agent's current plan for a task (update_progress), kept across turns so each update can
-- change only what moved and the agent can read the plan back after its context is compacted.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS progress_json jsonb;
