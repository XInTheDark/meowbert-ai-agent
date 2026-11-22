-- The run that adopted a warm sandbox. The container keeps the label of the run that created it,
-- so orphan cleanup needs this row to know the sandbox is in use until the adopting run ends.
ALTER TABLE task_warm_sandboxes
  ADD COLUMN IF NOT EXISTS adopted_by_run_id uuid;
