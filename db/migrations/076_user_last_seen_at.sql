ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

UPDATE users
   SET last_seen_at = COALESCE(last_seen_at, last_login_at, created_at)
 WHERE last_seen_at IS NULL;
