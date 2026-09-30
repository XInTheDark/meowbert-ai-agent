ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;

UPDATE tasks t
   SET is_hidden = true
  FROM memory_synthesis_requests msr
 WHERE msr.task_id = t.id;
