ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS web_push_vapid_public_key text,
  ADD COLUMN IF NOT EXISTS web_push_vapid_private_key text,
  ADD COLUMN IF NOT EXISTS web_push_contact_email text DEFAULT 'mailto:admin@meowbert.local';

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_web_push_subscriptions_user_id ON web_push_subscriptions(user_id);
