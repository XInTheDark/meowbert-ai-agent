ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS public_share_id uuid;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS public_shared_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_public_share_id
  ON tasks(public_share_id)
  WHERE public_share_id IS NOT NULL;
