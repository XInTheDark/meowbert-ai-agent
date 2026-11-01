import { restoreTaskArchiveRecords } from "./task-history-archive-batches.js";
import type { TaskHistoryPayloadReader } from "./task-history-payload-reader.js";
import type { TaskHistoryArchiveQueryable } from "./task-history-archive.js";

export interface TaskContextArchive {
  history: Array<{ id: string; payload_json: Record<string, unknown> }>;
  notes: Array<{ id: string; content: string }>;
  windowPrompts?: Array<{ id: string; opening_prompt_json: unknown[] }>;
  windowRequests?: Array<{ id: string; request_state_json: Record<string, unknown> }>;
}

export async function loadTaskContextArchive(client: TaskHistoryArchiveQueryable, taskId: string, reader?: TaskHistoryPayloadReader): Promise<TaskContextArchive> {
  const [history, notes, windowPrompts, windowRequests] = await Promise.all([
    client.query<TaskContextArchive["history"][number]>(
      "SELECT id, payload_json FROM task_context_history_items WHERE task_id = $1 ORDER BY window_id, ordinal, id", [taskId]
    ),
    client.query<TaskContextArchive["notes"][number]>(
      "SELECT id, content FROM task_context_notes WHERE task_id = $1 ORDER BY id", [taskId]
    ),
    client.query<NonNullable<TaskContextArchive["windowPrompts"]>[number]>(
      "SELECT id, opening_prompt_json FROM task_context_windows WHERE task_id = $1 AND (opening_prompt_json IS NOT NULL OR EXISTS (SELECT 1 FROM task_history_payloads p WHERE p.task_id = $1 AND p.kind = 'window_prompts' AND p.payload_id = task_context_windows.id::text)) ORDER BY id", [taskId]
    ),
    client.query<NonNullable<TaskContextArchive["windowRequests"]>[number]>(
      "SELECT id, request_state_json FROM task_context_windows WHERE task_id = $1 AND (request_state_json IS NOT NULL OR EXISTS (SELECT 1 FROM task_history_payloads p WHERE p.task_id = $1 AND p.kind = 'window_requests' AND p.payload_id = task_context_windows.id::text)) ORDER BY id", [taskId]
    )
  ]);
  return {
    history: reader ? await reader(taskId, "context_history", history.rows) : history.rows,
    notes: reader ? await reader(taskId, "context_notes", notes.rows) : notes.rows,
    windowPrompts: reader ? await reader(taskId, "window_prompts", windowPrompts.rows) : windowPrompts.rows,
    windowRequests: reader ? await reader(taskId, "window_requests", windowRequests.rows) : windowRequests.rows
  };
}

export async function stubTaskContextArchive(client: TaskHistoryArchiveQueryable, taskId: string): Promise<void> {
  // Keep identities and ancestry in place; only move the large payloads to cold storage.
  await client.query("UPDATE task_context_history_items SET payload_json = '{}'::jsonb WHERE task_id = $1", [taskId]);
  await client.query("UPDATE task_context_notes SET content = '' WHERE task_id = $1", [taskId]);
  await client.query("UPDATE task_context_windows SET opening_prompt_json = NULL WHERE task_id = $1", [taskId]);
  await client.query("UPDATE task_context_windows SET request_state_json = NULL WHERE task_id = $1", [taskId]);
}

export async function restoreTaskContextArchive(client: TaskHistoryArchiveQueryable, context: TaskContextArchive | undefined, taskId: string): Promise<void> {
  if (!context) return;
  await restoreTaskArchiveRecords(client, taskId, "context_history", context.history);
  await restoreTaskArchiveRecords(client, taskId, "context_notes", context.notes);
  await restoreTaskArchiveRecords(client, taskId, "window_prompts", context.windowPrompts ?? []);
  await restoreTaskArchiveRecords(client, taskId, "window_requests", context.windowRequests ?? []);
}
