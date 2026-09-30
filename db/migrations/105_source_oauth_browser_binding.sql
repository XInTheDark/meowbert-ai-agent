DELETE FROM workspace_source_oauth_states;

ALTER TABLE workspace_source_oauth_states
  ADD COLUMN browser_nonce_hash text NOT NULL;
