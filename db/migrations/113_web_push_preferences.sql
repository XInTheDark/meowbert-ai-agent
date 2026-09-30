ALTER TABLE web_push_subscriptions
  ADD COLUMN IF NOT EXISTS notify_on_background_responses boolean NOT NULL DEFAULT true;
