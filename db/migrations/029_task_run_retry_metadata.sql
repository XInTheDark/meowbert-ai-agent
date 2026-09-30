ALTER TABLE task_runs
  ADD COLUMN IF NOT EXISTS retry_series_started_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE task_runs
  ADD COLUMN IF NOT EXISTS retry_sequence_no int NOT NULL DEFAULT 1
  CHECK (retry_sequence_no > 0);
