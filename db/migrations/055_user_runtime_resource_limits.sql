ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sandbox_pids_limit integer;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sandbox_memory_mb integer;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sandbox_cpus numeric(10, 3);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS workspace_storage_mb integer;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_sandbox_pids_limit_check;

ALTER TABLE users
  ADD CONSTRAINT users_sandbox_pids_limit_check
  CHECK (sandbox_pids_limit IS NULL OR sandbox_pids_limit >= 1);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_sandbox_memory_mb_check;

ALTER TABLE users
  ADD CONSTRAINT users_sandbox_memory_mb_check
  CHECK (sandbox_memory_mb IS NULL OR sandbox_memory_mb >= 1);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_sandbox_cpus_check;

ALTER TABLE users
  ADD CONSTRAINT users_sandbox_cpus_check
  CHECK (sandbox_cpus IS NULL OR sandbox_cpus > 0);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_workspace_storage_mb_check;

ALTER TABLE users
  ADD CONSTRAINT users_workspace_storage_mb_check
  CHECK (workspace_storage_mb IS NULL OR workspace_storage_mb >= 1);
