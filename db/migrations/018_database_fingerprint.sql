-- Database fingerprint: a unique UUID generated once per database instance.
-- If this value changes between restarts, the underlying storage was replaced.

CREATE TABLE IF NOT EXISTS database_fingerprint (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  fingerprint uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO database_fingerprint (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
