ALTER TABLE usage_activation_schedules
  ADD COLUMN IF NOT EXISTS target_type text NOT NULL DEFAULT 'ai_provider'
    CHECK (target_type IN ('ai_provider', 'antigravity'));

ALTER TABLE usage_activation_schedules
  ADD COLUMN IF NOT EXISTS antigravity_credential_ids uuid[] NOT NULL DEFAULT '{}';
