ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS debug_mode boolean NOT NULL DEFAULT false;
