import { query } from "../../lib/db.js";

export interface MarkedTaskArtifact {
  relativePath: string;
  size: number;
}

export async function unmarkTaskArtifacts(taskId: string, relativePaths: string[]): Promise<void> {
  if (relativePaths.length === 0) {
    return;
  }

  await query(
    `DELETE FROM task_artifacts
      WHERE task_id = $1
        AND kind = 'artifact'
        AND relative_path = ANY($2::text[])`,
    [taskId, relativePaths]
  );
}

export async function markTaskArtifacts(taskId: string, artifacts: MarkedTaskArtifact[]): Promise<void> {
  if (artifacts.length === 0) {
    return;
  }

  const relativePaths = artifacts.map((artifact) => artifact.relativePath);
  await unmarkTaskArtifacts(taskId, relativePaths);

  for (const artifact of artifacts) {
    await query(
      `INSERT INTO task_artifacts (task_id, kind, relative_path, size_bytes, mime_type)
       VALUES ($1, 'artifact', $2, $3, 'application/octet-stream')`,
      [taskId, artifact.relativePath, artifact.size]
    );
  }
}
