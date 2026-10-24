-- Milestone 1 local execution state. Existing rows stay cloud-hosted and are not re-routed.

CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  platform text NOT NULL,
  architecture text NOT NULL,
  executor_version text NOT NULL,
  capabilities_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  max_concurrent_runs integer NOT NULL DEFAULT 2 CHECK (max_concurrent_runs > 0),
  verified_roots_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  stream_expires_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devices_user_active ON devices(user_id, revoked_at, updated_at DESC);

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS execution_target jsonb NOT NULL DEFAULT '{"kind":"cloud"}'::jsonb,
  ADD COLUMN IF NOT EXISTS device_facts jsonb;

ALTER TABLE task_run_dispatches
  ADD COLUMN IF NOT EXISTS lease_device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pending_reason text;

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS sandbox_image_reference text,
  ADD COLUMN IF NOT EXISTS sandbox_image_digest text;
