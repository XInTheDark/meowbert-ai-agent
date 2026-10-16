CREATE TABLE IF NOT EXISTS memory_embedding_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  provider_id uuid REFERENCES ai_providers(id) ON DELETE SET NULL,
  model text NOT NULL DEFAULT 'text-embedding-3-small' CHECK (length(btrim(model)) > 0),
  document_template text,
  query_template text,
  index_generation integer NOT NULL DEFAULT 1 CHECK (index_generation >= 1),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO memory_embedding_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS memory_reindex_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  concurrency integer NOT NULL CHECK (concurrency BETWEEN 1 AND 32),
  index_generation integer NOT NULL,
  total_workspaces integer NOT NULL DEFAULT 0,
  completed_workspaces integer NOT NULL DEFAULT 0,
  failed_workspaces integer NOT NULL DEFAULT 0,
  active_workspaces_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  heartbeat_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS memory_reindex_jobs_single_active
  ON memory_reindex_jobs ((true)) WHERE status IN ('queued', 'running');
