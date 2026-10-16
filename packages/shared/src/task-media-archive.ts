import { z } from "zod";
import type { TaskHistoryArchiveQueryable } from "./task-history-archive.js";

export const taskMediaArchiveSchema = z.array(z.object({
  sha256: z.string().min(1),
  mime_type: z.string().min(1),
  bytes_base64: z.string()
}));
export type TaskMediaArchive = z.infer<typeof taskMediaArchiveSchema>;

export async function loadTaskMediaArchive(client: TaskHistoryArchiveQueryable, taskId: string): Promise<TaskMediaArchive> {
  const result = await client.query<{ sha256: string; mime_type: string; bytes: Buffer }>(
    "SELECT sha256, mime_type, bytes FROM task_media_blobs WHERE task_id = $1 ORDER BY sha256", [taskId]);
  return result.rows.map((row) => ({ sha256: row.sha256, mime_type: row.mime_type, bytes_base64: row.bytes.toString("base64") }));
}

export async function stubTaskMediaArchive(client: TaskHistoryArchiveQueryable, taskId: string): Promise<void> {
  await client.query("DELETE FROM task_media_blobs WHERE task_id = $1", [taskId]);
}

export async function restoreTaskMediaArchive(
  client: TaskHistoryArchiveQueryable,
  taskId: string,
  archive?: TaskMediaArchive
): Promise<void> {
  if (!archive) return;
  for (const blob of archive) await client.query(
    `INSERT INTO task_media_blobs (task_id, sha256, mime_type, bytes)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (task_id, sha256) DO NOTHING`,
    [taskId, blob.sha256, blob.mime_type, Buffer.from(blob.bytes_base64, "base64")]);
}
