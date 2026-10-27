CREATE TABLE canvas_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canvas_id uuid REFERENCES project_canvases(id) ON DELETE CASCADE,
  task_id uuid REFERENCES tasks(id) ON DELETE CASCADE,
  relative_path text NOT NULL,
  element jsonb NOT NULL,
  body text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((canvas_id IS NULL) <> (task_id IS NULL))
);
CREATE INDEX canvas_comments_canvas_page ON canvas_comments(canvas_id, relative_path, created_at);
CREATE INDEX canvas_comments_task_page ON canvas_comments(task_id, relative_path, created_at);
