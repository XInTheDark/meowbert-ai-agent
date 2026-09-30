CREATE TABLE IF NOT EXISTS storage_backend_cache_project_ids (
  backend_id text PRIMARY KEY,
  project_id integer NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
