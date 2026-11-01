import { buildTaskArchiveStub, type ArchiveTaskHistoryResult, type TaskHistoryArchiveDeps, type TaskHistoryArchiveDocument } from "./task-history-archive.js";
import { writeArchiveSection } from "./task-history-archive-format.js";
import { loadArchiveSegments, stubArchiveSegment } from "./task-history-segment-store.js";
import { publishTaskArchiveReferences } from "./task-history-payload-reader.js";
import type { TaskArchiveReference, TaskArchiveSection } from "./task-history-archive-sections.js";

interface SegmentTask { id: string; workspace_id: string; environment_id: string; task_history_state: string; task_history_last_active_at: Date | string }

export async function archiveTaskHistorySegments(taskId: string, cutoff: string, deps: TaskHistoryArchiveDeps): Promise<ArchiveTaskHistoryResult> {
  if (!deps.archiveConfig.enabled) return { status: "skipped", reason: "Archive storage is disabled." };
  const prepared = await deps.db.withTransaction(async (client) => {
    const result = await client.query<SegmentTask>(
      "SELECT id, workspace_id, environment_id, task_history_state, task_history_last_active_at FROM tasks WHERE id = $1 FOR UPDATE", [taskId]);
    const task = result.rows[0];
    if (!task || task.task_history_state !== "warm") return null;
    const sections = await loadArchiveSegments(client, taskId, cutoff);
    return { task, sections };
  });
  if (!prepared || !Object.values(prepared.sections).some((items) => items?.length)) return { status: "skipped", reason: "No completed segment is eligible." };
  const document: TaskHistoryArchiveDocument = { version: 2, task: {
    id: taskId, workspace_id: prepared.task.workspace_id, environment_id: prepared.task.environment_id,
    archived_at: (deps.now?.() ?? new Date()).toISOString(), last_active_at: new Date(prepared.task.task_history_last_active_at).toISOString()
  }, messages: [], events: [], message_revisions: [] };
  const references: TaskArchiveReference[] = [];
  let originalSizeBytes = 0;
  let compressedSizeBytes = 0;
  for (const kind of Object.keys(prepared.sections) as TaskArchiveSection[]) {
    const items = prepared.sections[kind]!;
    originalSizeBytes += Buffer.byteLength(JSON.stringify(items));
    const stored = kind === "messages" ? items.map(({ role: _role, ...item }) => item) : items;
    const written = await writeArchiveSection(deps.archiveConfig, document, kind, stored);
    references.push(...written.references); compressedSizeBytes += written.compressedSizeBytes;
  }
  const published = await deps.db.withTransaction(async (client) => {
    const task = await client.query<SegmentTask>(
      "SELECT id, task_history_state FROM tasks WHERE id = $1 FOR UPDATE", [taskId]);
    if (task.rows[0]?.task_history_state !== "warm") return [];
    const valid = new Set<string>();
    for (const kind of Object.keys(prepared.sections) as TaskArchiveSection[]) {
      let items = prepared.sections[kind]!;
      if (kind === "messages") items = items.map((item) => ({ ...item,
        stub: buildTaskArchiveStub(item.role as "tool", item.content_json as Record<string, unknown>) }));
      // Equality guards preserve a concurrent edit. All stubs and references commit together.
      for (const id of await stubArchiveSegment(client, taskId, kind, items, cutoff)) valid.add(`${kind}:${id}`);
    }
    const kept = references.filter((ref) => valid.has(`${ref.kind}:${ref.payload_id}`));
    await publishTaskArchiveReferences(client, taskId, kept);
    if (kept.length) await client.query(
      "UPDATE tasks SET task_history_archive_key = COALESCE(task_history_archive_key, $2) WHERE id = $1", [taskId, kept[0].archive_key]);
    return kept;
  });
  if (!published.length) return { status: "skipped", reason: "Segments changed before publication." };
  return { status: "archived", archiveKey: published[0].archive_key, metrics: { originalSizeBytes, compressedSizeBytes,
    messageCount: published.filter((ref) => ref.kind === "messages").length, eventCount: 0, revisionCount: 0 } };
}
