ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS enable_prompt_caching boolean NOT NULL DEFAULT true;
