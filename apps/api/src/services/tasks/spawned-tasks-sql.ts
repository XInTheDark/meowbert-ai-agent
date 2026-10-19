// Agents a task spawned (subagents, subtasks, swarm/long-horizon workflow children),
// recursively. Thread side-conversations are user-started and keep their own usage.
// Binds the root task id as $1.
export const SPAWNED_TASKS_CTE = `WITH RECURSIVE spawned_tasks(id) AS (
    SELECT t.id FROM tasks t
     WHERE (t.parent_task_id = $1 OR t.workflow_parent_task_id = $1)
       AND NOT EXISTS (SELECT 1 FROM task_threads th WHERE th.task_id = t.id)
    UNION
    SELECT t.id FROM tasks t
      JOIN spawned_tasks s ON t.parent_task_id = s.id OR t.workflow_parent_task_id = s.id
     WHERE NOT EXISTS (SELECT 1 FROM task_threads th WHERE th.task_id = t.id)
  )`;
