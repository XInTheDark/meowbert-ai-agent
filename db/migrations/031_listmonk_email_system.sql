ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS enable_forgot_password boolean NOT NULL DEFAULT false;

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS require_email_verification_on_signup boolean NOT NULL DEFAULT false;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS newsletter_subscribed boolean NOT NULL DEFAULT true;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS newsletter_unsubscribed_at timestamptz;

UPDATE users
   SET email_verified_at = created_at
 WHERE email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_email_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  challenge_type text NOT NULL CHECK (challenge_type IN ('signup_verification', 'password_reset')),
  secret_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  requested_by_ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_email_challenges_user_type_created
  ON auth_email_challenges(user_id, challenge_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_email_challenges_email_type_created
  ON auth_email_challenges(email, challenge_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_email_challenges_unconsumed
  ON auth_email_challenges(challenge_type, email, expires_at)
  WHERE consumed_at IS NULL;

CREATE TABLE IF NOT EXISTS email_template_bindings (
  template_key text PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('listmonk')),
  provider_template_id bigint NOT NULL,
  template_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS newsletter_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  body_text text NOT NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'completed', 'failed'))
);

CREATE TABLE IF NOT EXISTS email_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_type text NOT NULL CHECK (message_type IN ('signup_verification', 'password_reset', 'newsletter')),
  template_key text NOT NULL,
  recipient_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  recipient_email text NOT NULL,
  subject text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  campaign_id uuid REFERENCES newsletter_campaigns(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  provider_message_id text,
  last_error text,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_status_created
  ON email_outbox(status, created_at);

CREATE INDEX IF NOT EXISTS idx_email_outbox_campaign_status
  ON email_outbox(campaign_id, status)
  WHERE campaign_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_outbox_recipient_type_created
  ON email_outbox(recipient_email, message_type, created_at DESC);

CREATE TABLE IF NOT EXISTS newsletter_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES newsletter_campaigns(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  email text NOT NULL,
  outbox_email_id uuid REFERENCES email_outbox(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, email)
);

CREATE INDEX IF NOT EXISTS idx_newsletter_recipients_campaign_status
  ON newsletter_recipients(campaign_id, status);
