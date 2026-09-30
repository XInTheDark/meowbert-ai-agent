ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS usage_rate_multiplier numeric(12, 4) NOT NULL DEFAULT 1;

ALTER TABLE user_token_usage_events
  ADD COLUMN IF NOT EXISTS usage_event_kind text NOT NULL DEFAULT 'model_response',
  ADD COLUMN IF NOT EXISTS cached_input_tokens integer NOT NULL DEFAULT 0 CHECK (cached_input_tokens >= 0),
  ADD COLUMN IF NOT EXISTS reasoning_tokens integer NOT NULL DEFAULT 0 CHECK (reasoning_tokens >= 0),
  ADD COLUMN IF NOT EXISTS input_token_multiplier numeric(12, 4) NOT NULL DEFAULT 1 CHECK (input_token_multiplier >= 0),
  ADD COLUMN IF NOT EXISTS cached_input_token_multiplier numeric(12, 4) NOT NULL DEFAULT 1 CHECK (cached_input_token_multiplier >= 0),
  ADD COLUMN IF NOT EXISTS output_token_multiplier numeric(12, 4) NOT NULL DEFAULT 1 CHECK (output_token_multiplier >= 0),
  ADD COLUMN IF NOT EXISTS reasoning_token_multiplier numeric(12, 4) NOT NULL DEFAULT 1 CHECK (reasoning_token_multiplier >= 0),
  ADD COLUMN IF NOT EXISTS usage_rate_multiplier numeric(12, 4) NOT NULL DEFAULT 1 CHECK (usage_rate_multiplier >= 0),
  ADD COLUMN IF NOT EXISTS adjusted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS adjustment_reason text;

ALTER TABLE user_token_usage_events
  DROP CONSTRAINT IF EXISTS user_token_usage_events_weighted_tokens_check;

ALTER TABLE user_token_usage_events
  ADD CONSTRAINT user_token_usage_events_weighted_tokens_signed_check
    CHECK (
      (usage_event_kind = 'admin_adjustment')
      OR weighted_tokens >= 0
    );

ALTER TABLE user_token_usage_events
  DROP CONSTRAINT IF EXISTS user_token_usage_events_usage_event_kind_check;

ALTER TABLE user_token_usage_events
  ADD CONSTRAINT user_token_usage_events_usage_event_kind_check
    CHECK (usage_event_kind IN ('model_response', 'admin_adjustment'));

CREATE INDEX IF NOT EXISTS idx_user_token_usage_events_adjusted_by_user_id
  ON user_token_usage_events(adjusted_by_user_id)
  WHERE adjusted_by_user_id IS NOT NULL;
