ALTER TABLE persistent_shell_sessions
  ADD COLUMN IF NOT EXISTS lifetime_seconds integer NOT NULL DEFAULT 43200
  CHECK (lifetime_seconds > 0 AND lifetime_seconds <= 1209600),
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

UPDATE persistent_shell_sessions
   SET expires_at = created_at + interval '12 hours'
 WHERE expires_at IS NULL;

ALTER TABLE persistent_shell_sessions
  ALTER COLUMN expires_at SET NOT NULL,
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '12 hours');

CREATE INDEX IF NOT EXISTS idx_persistent_shell_sessions_expires_at
  ON persistent_shell_sessions(expires_at)
  WHERE status IN ('starting', 'running', 'idle');
