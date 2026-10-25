import type { PoolClient } from "pg";
import { query, withTransaction } from "../../lib/db.js";
import type { SavedUploadedFile } from "./save-uploaded-file.js";

// Inputs are known by name at upload time; claims never list the task directory.
export async function recordTaskUpload(environmentId: string, file: SavedUploadedFile): Promise<void> {
  const pending = /^\.meowbert\/task-runs\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/(inputs\/.+)$/i.exec(file.relativePath);
  await withTransaction(async (client) => {
    if (pending) await lockTaskInputUploads(client, pending[1]);
    const recorded = await client.query(
      `INSERT INTO task_artifacts (task_id, kind, relative_path, size_bytes, sha256)
       SELECT id, 'input', substring($2::text FROM length(task_root_path) + 2), $3, $4
         FROM tasks
        WHERE environment_id = $1 AND starts_with($2::text, rtrim(task_root_path, '/') || '/inputs/')
       ON CONFLICT (task_id, relative_path) WHERE kind = 'input'
       DO UPDATE SET size_bytes = EXCLUDED.size_bytes, sha256 = EXCLUDED.sha256
       RETURNING task_id`,
      [environmentId, file.relativePath, file.sizeBytes, file.sha256]
    );
    if (pending && !recorded.rows.length) {
      await client.query(
        `INSERT INTO pending_task_inputs (environment_id, task_id, relative_path, size_bytes, sha256)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (environment_id, task_id, relative_path)
         DO UPDATE SET size_bytes = EXCLUDED.size_bytes, sha256 = EXCLUDED.sha256`,
        [environmentId, pending[1], pending[2], file.sizeBytes, file.sha256]
      );
    }
  });
}

export async function lockTaskInputUploads(client: PoolClient, taskId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [taskId]);
}

export async function attachPendingTaskInputs(client: PoolClient, environmentId: string, taskId: string): Promise<void> {
  await client.query(
    `WITH staged AS (
       DELETE FROM pending_task_inputs WHERE environment_id = $1 AND task_id = $2
       RETURNING relative_path, size_bytes, sha256
     )
     INSERT INTO task_artifacts (task_id, kind, relative_path, size_bytes, sha256)
     SELECT $2, 'input', relative_path, size_bytes, sha256 FROM staged
     ON CONFLICT (task_id, relative_path) WHERE kind = 'input'
     DO UPDATE SET size_bytes = EXCLUDED.size_bytes, sha256 = EXCLUDED.sha256`,
    [environmentId, taskId]
  );
}

export async function removeTaskInputUploads(environmentId: string, deletedPaths: string[]): Promise<void> {
  if (!deletedPaths.length) return;
  await query(
    `WITH removed_pending AS (
       DELETE FROM pending_task_inputs p USING unnest($2::text[]) AS selected(path)
       WHERE p.environment_id = $1
         AND ('.meowbert/task-runs/' || p.task_id::text || '/' || p.relative_path = selected.path
           OR starts_with('.meowbert/task-runs/' || p.task_id::text || '/' || p.relative_path, selected.path || '/'))
     )
     DELETE FROM task_artifacts a USING tasks t, unnest($2::text[]) AS selected(path)
     WHERE a.task_id = t.id AND t.environment_id = $1 AND a.kind = 'input'
       AND (t.task_root_path || '/' || a.relative_path = selected.path
         OR starts_with(t.task_root_path || '/' || a.relative_path, selected.path || '/'))`,
    [environmentId, deletedPaths]
  );
}
