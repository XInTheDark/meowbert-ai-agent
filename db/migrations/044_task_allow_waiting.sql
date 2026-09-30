ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS allow_waiting boolean NOT NULL DEFAULT true;
