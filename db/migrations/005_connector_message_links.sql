CREATE TABLE IF NOT EXISTS connector_message_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES connector_threads(id) ON DELETE CASCADE,
  external_message_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_connector_message_links_thread_message
  ON connector_message_links(thread_id, external_message_id);

CREATE INDEX IF NOT EXISTS idx_connector_message_links_task_id
  ON connector_message_links(task_id);
