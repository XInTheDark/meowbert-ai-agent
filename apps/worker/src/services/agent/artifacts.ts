import { query } from "../../lib/db.js";
import path from "node:path";

export interface MarkedTaskArtifact {
  relativePath: string;
  size: number;
  sha256?: string;
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

export async function markTaskArtifacts(taskId: string, artifacts: MarkedTaskArtifact[], pending = false): Promise<void> {
  if (artifacts.length === 0) {
    return;
  }

  for (const artifact of artifacts) {
    if (!artifact.relativePath || path.posix.isAbsolute(artifact.relativePath) || artifact.relativePath.includes("\\")
      || artifact.relativePath.split("/").some((part) => part === ".." || part === "")
      || !Number.isSafeInteger(artifact.size) || artifact.size < 0
      || (artifact.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(artifact.sha256))
      || (pending && !artifact.sha256)) throw new Error("Invalid artifact path, size or SHA-256.");
  }
  const relativePaths = artifacts.map((artifact) => artifact.relativePath);
  await unmarkTaskArtifacts(taskId, relativePaths);

  for (const artifact of artifacts) {
    await query(
      `INSERT INTO task_artifacts (task_id, kind, relative_path, size_bytes, mime_type, sha256, publication_state, publication_next_check_at, publication_deadline_at)
       VALUES ($1, 'artifact', $2, $3, 'application/octet-stream', $4, $5,
         CASE WHEN $5 = 'pending' THEN now() END, CASE WHEN $5 = 'pending' THEN now() + interval '30 minutes' END)`,
      [taskId, artifact.relativePath, artifact.size, artifact.sha256 ?? null, pending ? "pending" : "available"]
    );
  }
}
