CREATE INDEX IF NOT EXISTS idx_user_token_usage_events_occurred_at
  ON user_token_usage_events(occurred_at);

CREATE INDEX IF NOT EXISTS idx_user_token_usage_events_model_occurred_at
  ON user_token_usage_events(model, occurred_at);

CREATE INDEX IF NOT EXISTS idx_user_token_usage_events_kind_occurred_at
  ON user_token_usage_events(usage_event_kind, occurred_at);
