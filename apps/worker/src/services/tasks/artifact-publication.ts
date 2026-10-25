import fs from "node:fs/promises";
import { resolveRealPathWithinRoot, sha256File } from "@meowbert/shared/server-security";
import { query } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";

export interface PendingArtifact {
  id: string; task_id: string; relative_path: string; size_bytes: string; sha256: string;
  task_root_path: string; root_path: string; publication_attempts: number; publication_deadline_at: string;
}

// Only the named artifact is inspected. A size match triggers one hash, never a tree walk.
export async function artifactVisibility(artifact: PendingArtifact, now = Date.now()): Promise<"pending" | "available" | "missing"> {
  if (now >= Date.parse(artifact.publication_deadline_at)) return "missing";
  try {
    const task = await resolveRealPathWithinRoot(artifact.root_path, artifact.task_root_path);
    const file = await resolveRealPathWithinRoot(task.absolutePath, artifact.relative_path);
    const stats = await fs.stat(file.absolutePath);
    if (stats.isFile() && stats.size === Number(artifact.size_bytes)) {
      return await sha256File(file.absolutePath) === artifact.sha256 ? "available" : "missing";
    }
  } catch (error) {
    if (!["ENOENT", "EIO", "ESTALE", "ENOTCONN", "ETIMEDOUT", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) return "missing";
  }
  return now >= Date.parse(artifact.publication_deadline_at) ? "missing" : "pending";
}

export async function publishPendingArtifactsOnce(): Promise<void> {
  const result = await query<PendingArtifact>(
    `WITH due AS (SELECT id FROM task_artifacts WHERE publication_state = 'pending'
       AND publication_next_check_at <= now() ORDER BY publication_next_check_at LIMIT 20 FOR UPDATE SKIP LOCKED),
     claimed AS (UPDATE task_artifacts a SET publication_next_check_at = now() + interval '1 minute'
       FROM due WHERE a.id = due.id RETURNING a.*)
     SELECT a.*, t.task_root_path, e.root_path FROM claimed a
       JOIN tasks t ON t.id = a.task_id JOIN environments e ON e.id = t.environment_id JOIN workspaces w ON w.id = e.workspace_id
       WHERE w.file_host->>'kind' = 'server'`
  );
  for (const artifact of result.rows) {
    const state = await artifactVisibility(artifact);
    const delay = Math.min(60_000, 1_000 * 2 ** Math.min(artifact.publication_attempts, 6));
    const updated = await query(
      `UPDATE task_artifacts SET publication_state = $2, publication_attempts = publication_attempts + 1,
         publication_next_check_at = CASE WHEN $2 = 'pending' THEN now() + ($3::double precision * interval '1 millisecond') END
       WHERE id = $1 AND publication_state = 'pending' RETURNING id`, [artifact.id, state, delay]
    );
    if (state !== "pending" && updated.rowCount) {
      await emitTaskEvent(artifact.task_id, "artifact", { publicationState: state, relativePath: artifact.relative_path })
        .catch((error) => console.warn("Unable to publish artifact visibility", error));
    }
  }
}
