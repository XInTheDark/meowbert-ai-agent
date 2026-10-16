-- Images and files the agent viewed, stored once per task by content hash. Stored response items
-- reference them instead of carrying the base64 data inline in every message.
CREATE TABLE IF NOT EXISTS task_media_blobs (
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  sha256 text NOT NULL,
  mime_type text NOT NULL,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, sha256)
);
