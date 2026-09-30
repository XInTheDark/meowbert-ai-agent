ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_byo_provider_check;

ALTER TABLE users
  ADD CONSTRAINT users_byo_provider_check
  CHECK (byo_provider IS NULL OR byo_provider IN ('openai_compatible', 'chatgpt_oauth'));

CREATE TABLE IF NOT EXISTS user_chatgpt_auth (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  account_id text,
  email text,
  selected_model text DEFAULT 'o4-mini',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_chatgpt_auth_expires_at ON user_chatgpt_auth (expires_at);
