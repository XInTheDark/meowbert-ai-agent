-- Existing cloud artifacts remain available; device artifacts are published by name.
ALTER TABLE task_run_dispatches ADD COLUMN IF NOT EXISTS storage_retry_at timestamptz;

ALTER TABLE task_artifacts
  ADD COLUMN IF NOT EXISTS sha256 text,
  ADD COLUMN IF NOT EXISTS publication_state text NOT NULL DEFAULT 'available'
    CHECK (publication_state IN ('pending', 'available', 'missing')),
  ADD COLUMN IF NOT EXISTS publication_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS publication_next_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS publication_deadline_at timestamptz;

CREATE INDEX IF NOT EXISTS task_artifacts_pending_publication
  ON task_artifacts (publication_next_check_at) WHERE publication_state = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS task_artifacts_input_path
  ON task_artifacts (task_id, relative_path) WHERE kind = 'input';

CREATE TABLE IF NOT EXISTS local_run_memory_refreshes (
  run_id uuid NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  delay_seconds integer NOT NULL CHECK (delay_seconds IN (0, 60, 300)),
  due_at timestamptz NOT NULL,
  PRIMARY KEY (run_id, delay_seconds)
);
CREATE INDEX IF NOT EXISTS local_run_memory_refreshes_due ON local_run_memory_refreshes (due_at);
