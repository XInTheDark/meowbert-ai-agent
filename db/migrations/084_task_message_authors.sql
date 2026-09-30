ALTER TABLE task_messages
  ADD COLUMN IF NOT EXISTS author_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

UPDATE task_messages tm
   SET author_user_id = t.initiator_user_id
  FROM tasks t
 WHERE tm.task_id = t.id
   AND tm.role = 'user'
   AND tm.author_user_id IS NULL
   AND t.initiator_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_messages_author_user
  ON task_messages(author_user_id);
