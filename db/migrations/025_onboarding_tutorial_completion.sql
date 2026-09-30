ALTER TABLE users
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;
