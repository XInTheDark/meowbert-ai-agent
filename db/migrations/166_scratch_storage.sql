ALTER TABLE platform_settings ADD COLUMN scratch_storage_limit_mb bigint
  CHECK (scratch_storage_limit_mb IS NULL OR scratch_storage_limit_mb > 0);

CREATE SEQUENCE task_scratch_project_id_seq AS integer START WITH 1000000000;
ALTER TABLE tasks
  ADD COLUMN scratch_project_id integer UNIQUE,
  ADD COLUMN scratch_present boolean NOT NULL DEFAULT true,
  ADD COLUMN scratch_evicted_at timestamptz;

CREATE INDEX idx_tasks_scratch_idle ON tasks (updated_at, id) WHERE scratch_present;
