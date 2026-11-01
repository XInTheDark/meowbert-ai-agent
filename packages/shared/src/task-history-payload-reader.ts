import type { TaskHistoryArchiveDeps, TaskHistoryArchiveQueryable } from "./task-history-archive.js";
import { archivePayloadId, archiveSection, type ArchivePayload, type TaskArchiveSection, type TaskArchiveReference } from "./task-history-archive-sections.js";
import { readArchiveChunk, readTaskArchive } from "./task-history-archive-format.js";
import { taskPayloadLocationSql } from "./task-history-payload-sources.js";

interface PayloadLocation { payload_id: string; archive_key: string | null; warm_payload?: ArchivePayload | null; task_history_state: string; task_history_archive_key: string | null }
export type TaskHistoryPayloadReader = <T extends object>(taskId: string, kind: TaskArchiveSection, rows: T[], projection?: "message_preview") => Promise<T[]>;

function messagePreview(payload: ArchivePayload): ArchivePayload {
  const content = payload.content_json as Record<string, unknown> | undefined;
  return { content_json: {
    text: String(content?.text ?? "").slice(0, 500),
    turn_summary: typeof content?.turn_summary === "string" ? content.turn_summary : null
  } };
}

export async function publishTaskArchiveReferences(db: TaskHistoryArchiveQueryable, taskId: string, references: TaskArchiveReference[]): Promise<void> {
  for (let offset = 0; offset < references.length; offset += 128) {
    await db.query(
      `INSERT INTO task_history_payloads (task_id, kind, payload_id, archive_key)
       SELECT $1, entry.kind, entry.payload_id, entry.archive_key
         FROM jsonb_to_recordset($2::jsonb) AS entry(kind text, payload_id text, archive_key text)
       ON CONFLICT (task_id, kind, payload_id) DO UPDATE SET archive_key = EXCLUDED.archive_key`,
      [taskId, JSON.stringify(references.slice(offset, offset + 128))]
    );
  }
}

export async function readTaskHistoryPayloads<T extends object>(taskId: string, kind: TaskArchiveSection, rows: T[], deps: Pick<TaskHistoryArchiveDeps, "archiveConfig"> & { db: Pick<TaskHistoryArchiveDeps["db"], "query"> }, projection?: "message_preview"): Promise<T[]> {
  if (!rows.length || !deps.archiveConfig.enabled) return rows;
  const ids = rows.map((row) => archivePayloadId(kind, row as ArchivePayload));
  const preview = kind === "messages" && projection === "message_preview";
  const locations = await deps.db.query<PayloadLocation>(taskPayloadLocationSql(kind, preview), [taskId, kind, ids]);
  const payloads = new Map<string, ArchivePayload>();
  const keys = new Set(locations.rows.flatMap((row) => row.archive_key ? [row.archive_key] : []));
  for (const key of keys) {
    for (const item of await readArchiveChunk(deps.archiveConfig, key, taskId, kind)) payloads.set(archivePayloadId(kind, item), item);
  }
  const state = locations.rows[0];
  if (state?.task_history_state === "archived" && ids.some((id) => !payloads.has(id))) {
    if (!state.task_history_archive_key) throw new Error("Archived task has no archive key.");
    const document = await readTaskArchive(deps.archiveConfig, state.task_history_archive_key);
    if (document.task.id !== taskId) throw new Error("Archive belongs to another task.");
    for (const item of archiveSection(document, kind)) payloads.set(archivePayloadId(kind, item), item);
    if (document.version === 1) await deps.db.query(
      "UPDATE tasks SET task_history_archive_conversion_requested = true WHERE id = $1 AND NOT task_history_archive_conversion_requested", [taskId]);
  }
  const required = new Set(locations.rows.flatMap((row) => row.archive_key ? [row.payload_id] : []));
  const warm = new Map(locations.rows.flatMap((row) => row.warm_payload ? [[row.payload_id, row.warm_payload] as const] : []));
  return rows.map((row, index) => {
    const payload = payloads.get(ids[index]);
    if (!payload && (required.has(ids[index]) || state?.task_history_state === "archived")) throw new Error(`Archive payload is missing: ${kind}/${ids[index]}`);
    const resolved = payload && (required.has(ids[index]) || state?.task_history_state === "archived")
      ? payload : warm.get(ids[index]);
    return { ...row, ...(preview ? messagePreview(resolved ?? (row as ArchivePayload)) : resolved) };
  });
}
