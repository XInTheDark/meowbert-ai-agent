ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS workspace_limit integer;

ALTER TABLE subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_workspace_limit_check;

ALTER TABLE subscription_plans
  ADD CONSTRAINT subscription_plans_workspace_limit_check
  CHECK (workspace_limit IS NULL OR workspace_limit >= 1);

ALTER TABLE users
  ALTER COLUMN workspace_limit DROP DEFAULT;

ALTER TABLE users
  ALTER COLUMN workspace_limit DROP NOT NULL;

UPDATE users
   SET workspace_limit = NULL
 WHERE workspace_limit = 1;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_workspace_limit_check;

ALTER TABLE users
  ADD CONSTRAINT users_workspace_limit_check
  CHECK (workspace_limit IS NULL OR workspace_limit >= 1);
