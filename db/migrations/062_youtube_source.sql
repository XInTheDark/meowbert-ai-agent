ALTER TABLE source_provider_settings
  DROP CONSTRAINT IF EXISTS source_provider_settings_provider_check;

ALTER TABLE source_provider_settings
  ADD CONSTRAINT source_provider_settings_provider_check
  CHECK (provider IN ('google-drive', 'onedrive', 'youtube'));

ALTER TABLE workspace_source_connections
  DROP CONSTRAINT IF EXISTS workspace_source_connections_provider_check;

ALTER TABLE workspace_source_connections
  ADD CONSTRAINT workspace_source_connections_provider_check
  CHECK (provider IN ('google-drive', 'onedrive', 'youtube'));

ALTER TABLE workspace_source_oauth_states
  DROP CONSTRAINT IF EXISTS workspace_source_oauth_states_provider_check;

ALTER TABLE workspace_source_oauth_states
  ADD CONSTRAINT workspace_source_oauth_states_provider_check
  CHECK (provider IN ('google-drive', 'onedrive', 'youtube'));

INSERT INTO source_provider_settings (provider, enabled)
VALUES ('youtube', false)
ON CONFLICT (provider) DO NOTHING;
