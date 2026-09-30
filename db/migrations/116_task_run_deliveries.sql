CREATE TABLE task_run_deliveries (
  run_id uuid PRIMARY KEY REFERENCES task_runs(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  payload_json jsonb NOT NULL,
  delivered_channels text[] NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text
);
CREATE INDEX task_run_deliveries_pending ON task_run_deliveries(next_attempt_at, run_id)
  WHERE completed_at IS NULL;
