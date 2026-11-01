import type { TaskHistoryArchiveDeps, ArchiveTaskHistoryResult } from "./task-history-archive.js";
import { readTaskArchive, writeTaskArchive } from "./task-history-archive-format.js";
import { publishTaskArchiveReferences } from "./task-history-payload-reader.js";

export async function convertTaskHistoryArchive(taskId: string, deps: TaskHistoryArchiveDeps): Promise<ArchiveTaskHistoryResult> {
  const result = await deps.db.query<{ task_history_archive_key: string; workspace_id: string; environment_id: string }>(
    "SELECT task_history_archive_key, workspace_id, environment_id FROM tasks WHERE id = $1 AND task_history_state = 'archived'", [taskId]);
  const task = result.rows[0];
  if (!task) return { status: "not_found" };
  const document = await readTaskArchive(deps.archiveConfig, task.task_history_archive_key);
  if (document.task.id !== taskId || document.task.workspace_id !== task.workspace_id || document.task.environment_id !== task.environment_id) throw new Error("Archive does not belong to this task.");
  const written = await writeTaskArchive(deps.archiveConfig, document);
  const published = await deps.db.withTransaction(async (client) => {
    const locked = await client.query<{ task_history_archive_key: string; task_history_state: string }>(
      "SELECT task_history_archive_key, task_history_state FROM tasks WHERE id = $1 FOR UPDATE", [taskId]);
    if (locked.rows[0]?.task_history_state !== "archived" || locked.rows[0].task_history_archive_key !== task.task_history_archive_key) return false;
    await publishTaskArchiveReferences(client, taskId, written.references);
    await client.query(
      "UPDATE tasks SET task_history_archive_key = $2, task_history_archive_conversion_requested = false WHERE id = $1", [taskId, written.archiveKey]);
    return true;
  });
  // Keep the legacy file for readers which selected its key before this transaction. Task deletion removes it.
  return published ? { status: "archived", archiveKey: written.archiveKey, metrics: { ...written,
    messageCount: document.messages.length, eventCount: document.events.length, revisionCount: document.message_revisions.length } }
    : { status: "skipped", reason: "Task changed during archive conversion." };
}
