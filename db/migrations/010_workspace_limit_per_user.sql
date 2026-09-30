ALTER TABLE users
  ADD COLUMN IF NOT EXISTS workspace_limit integer NOT NULL DEFAULT 1;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_workspace_limit_check;

ALTER TABLE users
  ADD CONSTRAINT users_workspace_limit_check CHECK (workspace_limit >= 1);

UPDATE users
   SET workspace_limit = 1
 WHERE workspace_limit < 1;
