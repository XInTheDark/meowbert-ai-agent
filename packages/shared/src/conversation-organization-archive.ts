import { z } from "zod";
import type { TaskHistoryArchiveQueryable } from "./task-history-archive.js";

export const conversationSnapshotArchiveSchema = z.array(z.object({
  id: z.string().uuid(), payload_json: z.record(z.string(), z.unknown())
}));
export type ConversationSnapshotArchive = z.infer<typeof conversationSnapshotArchiveSchema>;

export async function loadConversationSnapshotArchive(db: TaskHistoryArchiveQueryable, taskId: string): Promise<ConversationSnapshotArchive> {
  return (await db.query<ConversationSnapshotArchive[number]>(
    "SELECT id, payload_json FROM task_conversation_snapshots WHERE task_id = $1", [taskId])).rows;
}

export async function stubConversationSnapshotArchive(db: TaskHistoryArchiveQueryable, taskId: string): Promise<void> {
  await db.query("UPDATE task_conversation_snapshots SET payload_json = '{}'::jsonb WHERE task_id = $1", [taskId]);
}

export async function restoreConversationSnapshotArchive(db: TaskHistoryArchiveQueryable, archive?: ConversationSnapshotArchive): Promise<void> {
  for (const snapshot of archive ?? []) await db.query(
    "UPDATE task_conversation_snapshots SET payload_json = $2::jsonb WHERE id = $1", [snapshot.id, JSON.stringify(snapshot.payload_json)]);
}
