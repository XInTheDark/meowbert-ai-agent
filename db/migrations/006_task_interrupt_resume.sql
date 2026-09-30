ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS resume_after_interrupt boolean NOT NULL DEFAULT false;
