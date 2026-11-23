-- How eagerly idle task scratch in a project is cleared. Set by platform admins.
ALTER TABLE environments
  ADD COLUMN IF NOT EXISTS scratch_priority text NOT NULL DEFAULT 'normal'
    CHECK (scratch_priority IN ('low', 'normal', 'high'));

-- The worker's latest scratch usage breakdown, written on each cleanup pass so the API need not read XFS quotas.
ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS scratch_usage jsonb;
