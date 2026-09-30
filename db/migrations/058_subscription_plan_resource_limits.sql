ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS sandbox_pids_limit integer;

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS sandbox_memory_mb integer;

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS sandbox_cpus numeric(10, 3);

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS workspace_storage_mb integer;

ALTER TABLE subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_sandbox_pids_limit_check;

ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_sandbox_pids_limit_check
  CHECK (sandbox_pids_limit IS NULL OR sandbox_pids_limit >= 1);

ALTER TABLE subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_sandbox_memory_mb_check;

ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_sandbox_memory_mb_check
  CHECK (sandbox_memory_mb IS NULL OR sandbox_memory_mb >= 1);

ALTER TABLE subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_sandbox_cpus_check;

ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_sandbox_cpus_check
  CHECK (sandbox_cpus IS NULL OR sandbox_cpus > 0);

ALTER TABLE subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_workspace_storage_mb_check;

ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_workspace_storage_mb_check
  CHECK (workspace_storage_mb IS NULL OR workspace_storage_mb >= 1);
