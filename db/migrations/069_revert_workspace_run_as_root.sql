UPDATE workspace_settings
   SET run_as_root = false
 WHERE run_as_root IS DISTINCT FROM false;

ALTER TABLE workspace_settings
  ALTER COLUMN run_as_root SET DEFAULT false;
