-- The composer uploads inputs before creating its client-generated task UUID.
CREATE TABLE pending_task_inputs (
  environment_id uuid NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  task_id uuid NOT NULL,
  relative_path text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL,
  PRIMARY KEY (environment_id, task_id, relative_path)
);
