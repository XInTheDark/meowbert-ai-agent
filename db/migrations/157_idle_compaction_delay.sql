-- Admins can set how long a task sits idle before it is compacted. NULL keeps the automatic delay,
-- a fraction of the model's prompt cache lifetime.
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS idle_compaction_delay_seconds integer
  CHECK (idle_compaction_delay_seconds IS NULL OR idle_compaction_delay_seconds BETWEEN 1 AND 86400);
