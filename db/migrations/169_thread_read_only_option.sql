-- Threads can choose whether to run read-only; preserve read-only for existing threads.
UPDATE tasks
   SET read_only = true
 WHERE id IN (SELECT task_id FROM task_threads)
   AND read_only = false;
