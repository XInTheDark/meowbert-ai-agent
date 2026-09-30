ALTER TABLE users
  ADD COLUMN IF NOT EXISTS session_valid_after timestamptz;

UPDATE users
   SET session_valid_after = date_trunc('second', now())
 WHERE session_valid_after IS NULL;

ALTER TABLE users
  ALTER COLUMN session_valid_after SET DEFAULT date_trunc('second', now()),
  ALTER COLUMN session_valid_after SET NOT NULL;
