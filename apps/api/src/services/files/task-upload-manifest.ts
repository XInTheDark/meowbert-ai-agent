import { query } from "../../lib/db.js";
import type { SavedUploadedFile } from "./save-uploaded-file.js";

// Inputs are known by name at upload time; claims never list the task directory.
export async function recordTaskUpload(environmentId: string, file: SavedUploadedFile): Promise<void> {
  await query(
    `INSERT INTO task_artifacts (task_id, kind, relative_path, size_bytes, sha256)
     SELECT id, 'input', substring($2::text FROM length(task_root_path) + 2), $3, $4
       FROM tasks
      WHERE environment_id = $1 AND starts_with($2::text, rtrim(task_root_path, '/') || '/inputs/')
     ON CONFLICT (task_id, relative_path) WHERE kind = 'input'
     DO UPDATE SET size_bytes = EXCLUDED.size_bytes, sha256 = EXCLUDED.sha256`,
    [environmentId, file.relativePath, file.sizeBytes, file.sha256]
  );
}
