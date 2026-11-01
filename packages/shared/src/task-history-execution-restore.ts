import type { TaskHistoryArchiveDeps, TaskHistoryArchiveDocument, TaskHistoryArchiveQueryable } from "./task-history-archive.js";
import { readTaskArchive } from "./task-history-archive-format.js";
import { ARCHIVE_SECTIONS, archivePayloadId, archiveSection, type TaskArchiveSection } from "./task-history-archive-sections.js";

// A running V2 task needs its open windows and durable notes, not every old window.
export async function readTaskExecutionArchive(taskId: string, key: string, deps: TaskHistoryArchiveDeps): Promise<TaskHistoryArchiveDocument> {
  const windows = await deps.db.query<{ id: string }>(
    "SELECT id FROM task_context_windows WHERE task_id = $1 AND closed_at IS NULL", [taskId]);
  const ids = windows.rows.map((window) => window.id);
  const history = await deps.db.query<{ id: string }>(
    "SELECT id FROM task_context_history_items WHERE task_id = $1 AND window_id = ANY($2::uuid[])", [taskId, ids]);
  const selection = {
    kinds: Object.keys(ARCHIVE_SECTIONS).filter((kind) => !["messages", "events", "message_revisions", "media", "conversation_snapshots"].includes(kind)) as TaskArchiveSection[],
    ids: { context_history: history.rows.map((item) => item.id), window_prompts: ids, window_requests: ids }
  };
  const document = await readTaskArchive(deps.archiveConfig, key, selection);
  // Legacy files cannot be selected by section; execution restores them once as before.
  return document;
}

export async function clearRestoredArchiveReferences(client: TaskHistoryArchiveQueryable, taskId: string, document: TaskHistoryArchiveDocument): Promise<void> {
  for (const kind of Object.keys(ARCHIVE_SECTIONS) as TaskArchiveSection[]) {
    const ids = archiveSection(document, kind).map((item) => archivePayloadId(kind, item));
    if (ids.length) await client.query(
      "DELETE FROM task_history_payloads WHERE task_id = $1 AND kind = $2 AND payload_id = ANY($3::text[])", [taskId, kind, ids]);
  }
}
