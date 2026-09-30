ALTER TABLE task_threads
  ADD COLUMN IF NOT EXISTS selected_text_location text;
