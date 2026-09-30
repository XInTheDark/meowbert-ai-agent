import type { TaskHistoryArchiveQueryable } from "./task-history-archive.js";

export interface TaskContextArchive {
  history: Array<{ id: string; payload_json: Record<string, unknown> }>;
  notes: Array<{ id: string; content: string }>;
}

export async function loadTaskContextArchive(client: TaskHistoryArchiveQueryable, taskId: string): Promise<TaskContextArchive> {
  const [history, notes] = await Promise.all([
    client.query<TaskContextArchive["history"][number]>(
      "SELECT id, payload_json FROM task_context_history_items WHERE task_id = $1", [taskId]
    ),
    client.query<TaskContextArchive["notes"][number]>(
      "SELECT id, content FROM task_context_notes WHERE task_id = $1", [taskId]
    )
  ]);
  return { history: history.rows, notes: notes.rows };
}

export async function stubTaskContextArchive(client: TaskHistoryArchiveQueryable, taskId: string): Promise<void> {
  // Keep identities and ancestry in place; only move the large payloads to cold storage.
  await client.query("UPDATE task_context_history_items SET payload_json = '{}'::jsonb WHERE task_id = $1", [taskId]);
  await client.query("UPDATE task_context_notes SET content = '' WHERE task_id = $1", [taskId]);
}

export async function restoreTaskContextArchive(client: TaskHistoryArchiveQueryable, context?: TaskContextArchive): Promise<void> {
  // Older archives predate private context storage and did not stub these rows.
  if (!context) return;
  for (const item of context.history) {
    await client.query("UPDATE task_context_history_items SET payload_json = $2::jsonb WHERE id = $1", [item.id, JSON.stringify(item.payload_json)]);
  }
  for (const note of context.notes) {
    await client.query("UPDATE task_context_notes SET content = $2 WHERE id = $1", [note.id, note.content]);
  }
}
