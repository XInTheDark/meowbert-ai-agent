-- Restrictions chosen when a task is created: no writes to project files, and no sandbox network.
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS read_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS network_disabled boolean NOT NULL DEFAULT false;
