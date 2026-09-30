import type { TaskHistoryArchiveQueryable } from "@meowbert/shared";

const MAX_OUTPUT_FILES = 20;

// Files a task marked as artifacts, as paths relative to the project root, so a later task in the
// same project can be pointed at them.
export async function loadTaskOutputFiles(db: TaskHistoryArchiveQueryable, taskId: string): Promise<string[]> {
  const result = await db.query<{ path: string }>(
    `SELECT rtrim(t.task_root_path, '/') || '/' || a.relative_path AS path
       FROM task_artifacts a
       JOIN tasks t ON t.id = a.task_id
      WHERE a.task_id = $1
        AND a.kind = 'artifact'
      ORDER BY a.created_at DESC, a.relative_path
      LIMIT $2`,
    [taskId, MAX_OUTPUT_FILES]
  );
  return result.rows.map((row) => row.path);
}
