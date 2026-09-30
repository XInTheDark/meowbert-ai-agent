ALTER TABLE workspace_settings
  ADD COLUMN IF NOT EXISTS run_as_root boolean NOT NULL DEFAULT false;
