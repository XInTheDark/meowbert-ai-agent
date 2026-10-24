import { query } from "../../lib/db.js";
import type { RunBootstrap } from "@meowbert/run-executor/agent/ports/run-bootstrap";

export async function loadRunInputManifest(taskId: string): Promise<NonNullable<RunBootstrap["inputs"]>> {
  const result = await query<{ relative_path: string; size_bytes: string; sha256: string }>(
    `SELECT relative_path, size_bytes, sha256 FROM task_artifacts
      WHERE task_id = $1 AND kind = 'input' AND sha256 IS NOT NULL ORDER BY relative_path`,
    [taskId]
  );
  return result.rows.map((row) => ({ relativePath: row.relative_path, sizeBytes: Number(row.size_bytes), sha256: row.sha256 }));
}
