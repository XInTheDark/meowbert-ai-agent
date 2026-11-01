import type { TaskHistoryArchiveDeps, TaskHistoryArchiveDocument, TaskHistoryArchiveQueryable } from "./task-history-archive.js";
import { readArchiveChunk } from "./task-history-archive-format.js";
import { archivePayloadId, documentFromSections, type ArchivePayload, type TaskArchiveReference, type TaskArchiveSection } from "./task-history-archive-sections.js";

// Editing/forking a partly cold task must materialize its archived rows before SQL copies them.
// Browsing and ordinary execution never call this path.
export async function materializeWarmTaskPayloads(taskId: string, deps: TaskHistoryArchiveDeps,
  restore: (client: TaskHistoryArchiveQueryable, document: TaskHistoryArchiveDocument) => Promise<void>): Promise<void> {
  const captured = await deps.db.query<TaskArchiveReference>(
    "SELECT kind, payload_id, archive_key FROM task_history_payloads WHERE task_id = $1", [taskId]);
  if (!captured.rows.length) return;
  const loaded = new Map<string, ArchivePayload[]>();
  for (const ref of captured.rows) {
    if (!loaded.has(ref.archive_key)) loaded.set(ref.archive_key, await readArchiveChunk(deps.archiveConfig, ref.archive_key, taskId, ref.kind));
  }
  await deps.db.withTransaction(async (client) => {
    const task = (await client.query<{ id: string; workspace_id: string; environment_id: string; task_history_state: string; task_history_last_active_at: Date }>(
      "SELECT id, workspace_id, environment_id, task_history_state, task_history_last_active_at FROM tasks WHERE id = $1 FOR UPDATE", [taskId])).rows[0];
    if (!task) return;
    if (task.task_history_state === "archived") throw new Error("Task was archived during this change. Retry the request.");
    if (task.task_history_state === "archiving") await client.query(
      "UPDATE tasks SET task_history_state = 'warm', task_history_archive_started_at = NULL, task_history_last_warmed_at = now() WHERE id = $1", [taskId]);
    const current = await client.query<TaskArchiveReference>(
      "SELECT kind, payload_id, archive_key FROM task_history_payloads WHERE task_id = $1", [taskId]);
    const capturedKeys = new Set(captured.rows.map((ref) => `${ref.kind}:${ref.payload_id}:${ref.archive_key}`));
    const sections: Partial<Record<TaskArchiveSection, ArchivePayload[]>> = {};
    for (const ref of current.rows) {
      if (!capturedKeys.has(`${ref.kind}:${ref.payload_id}:${ref.archive_key}`)) throw new Error("Task archive changed. Retry the request.");
      const item = loaded.get(ref.archive_key)?.find((entry) => archivePayloadId(ref.kind, entry) === ref.payload_id);
      if (!item) throw new Error("An archived task payload is missing.");
      (sections[ref.kind] ??= []).push(item);
    }
    const document = documentFromSections({ version: 2, task: {
      id: taskId, workspace_id: task.workspace_id, environment_id: task.environment_id,
      archived_at: new Date().toISOString(), last_active_at: new Date(task.task_history_last_active_at).toISOString()
    }, sections: {} }, sections);
    await restore(client, document);
  });
}
