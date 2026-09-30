ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS model_routers_json jsonb;

CREATE TABLE IF NOT EXISTS task_message_model_routes (
  task_message_id uuid NOT NULL REFERENCES task_messages(id) ON DELETE CASCADE,
  requested_model text NOT NULL,
  router_id text NOT NULL,
  routing_model text NOT NULL,
  resolved_model text NOT NULL,
  reasoning_score smallint NOT NULL CHECK (reasoning_score >= 0 AND reasoning_score <= 100),
  reason text NOT NULL,
  used_fallback boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_message_id, requested_model)
);
