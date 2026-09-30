ALTER TABLE users
  ADD COLUMN IF NOT EXISTS message_rate_limit integer CHECK (message_rate_limit IS NULL OR message_rate_limit >= 1);

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS default_message_rate_limit integer NOT NULL DEFAULT 200 CHECK (default_message_rate_limit >= 1);
