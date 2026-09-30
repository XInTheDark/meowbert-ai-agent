ALTER TABLE workspace_github_apps
  DROP CONSTRAINT IF EXISTS workspace_github_apps_installation_id_key;

DROP INDEX IF EXISTS workspace_github_apps_installation_id_key;

CREATE INDEX IF NOT EXISTS idx_workspace_github_apps_installation_id
  ON workspace_github_apps(installation_id)
  WHERE installation_id IS NOT NULL;
