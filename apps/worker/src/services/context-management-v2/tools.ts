import { readTaskPayloads } from "../tasks/task-history-reader.js";
import { query } from "../../lib/db.js";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { ContextHistoryWindow, ContextWindowRef, StoredContextHistoryItem } from "@meowbert/run-executor/agent/ports/run-control";
import type { ContextNoteRow } from "@meowbert/run-executor/context-management-v2/types";
import { accessibleNodesCte, writeContextNote } from "./service.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function limit(value: number | null | undefined): number {
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value ?? DEFAULT_LIMIT)));
}

export async function listContextHistoryWindows(state: ContextWindowRef): Promise<ContextHistoryWindow[]> {
  const result = await query<{ id: string; ordinal: number; last_item_id: string | null; history_limit: number | null }>(
    `${accessibleNodesCte(2)}
     SELECT w.id, w.ordinal, context_lineage.history_limit,
            (SELECT item.id FROM task_context_history_items item
              WHERE item.window_id = w.id
                AND (context_lineage.history_limit IS NULL OR item.ordinal <= context_lineage.history_limit)
              ORDER BY item.ordinal DESC
              LIMIT 1) AS last_item_id
       FROM task_context_windows w
       JOIN context_lineage ON context_lineage.id = w.context_node_id
      WHERE w.task_id = $1
      ORDER BY w.ordinal ASC`,
    [state.taskId, state.contextNodeId]
  );
  return result.rows.map((row) => ({ windowId: row.id, ordinal: row.ordinal, lastItemId: row.last_item_id, maxOrdinal: row.history_limit }));
}

export async function loadContextHistoryWindow(state: ContextWindowRef, windowId: string): Promise<StoredContextHistoryItem[]> {
  const result = await query<{ id: string; call_number: number | null; payload_json: ResponseInputItem }>(
    `${accessibleNodesCte(3)}
     SELECT item.id, item.call_number, item.payload_json
       FROM task_context_history_items item
       JOIN task_context_windows w ON w.id = item.window_id AND w.task_id = item.task_id
       JOIN context_lineage ON context_lineage.id = w.context_node_id
      WHERE item.task_id = $1 AND item.window_id = $2
        AND (context_lineage.history_limit IS NULL OR item.ordinal <= context_lineage.history_limit)
      ORDER BY item.ordinal ASC`,
    [state.taskId, windowId, state.contextNodeId]
  );
  return (await readTaskPayloads(state.taskId, "context_history", result.rows)).map((row) => ({ id: row.id, callNumber: row.call_number, item: row.payload_json }));
}

export async function listContextNotes(state: ContextWindowRef, input: {
  prefix?: string | null;
  contains?: string | null;
  max_results?: number | null;
  file_order_by?: "name" | "created_at" | "updated_at" | null;
  file_order?: "ascending" | "descending" | null;
}) {
  const field = input.file_order_by === "created_at" || input.file_order_by === "updated_at" ? input.file_order_by : "path";
  const direction = input.file_order === "descending" ? "DESC" : "ASC";
  const result = await query<ContextNoteRow>(
    `${accessibleNodesCte(4)}, effective_notes AS (
       SELECT DISTINCT ON (note.path) note.path, note.content, note.created_at, note.updated_at
         FROM task_context_notes note
         JOIN context_lineage ON context_lineage.id = note.context_node_id
        WHERE note.task_id = $1
          AND (context_lineage.note_revision_limit IS NULL OR note.revision <= context_lineage.note_revision_limit)
        ORDER BY note.path, context_lineage.depth ASC, note.revision DESC
     )
     SELECT path, content, created_at, updated_at
       FROM effective_notes
      WHERE ($2::text IS NULL OR path LIKE $2 || '%')
        AND ($5::text IS NULL OR strpos(content, $5) > 0)
      ORDER BY ${field} ${direction}
      LIMIT $3`,
    [state.taskId, input.prefix ?? null, limit(input.max_results), state.contextNodeId, input.contains ?? null]
  );
  return { files: result.rows.map((note) => ({ path: note.path, bytes: Buffer.byteLength(note.content, "utf8"), created_at: note.created_at, updated_at: note.updated_at })) };
}

export async function readContextNote(state: ContextWindowRef, input: { path: string; start_line?: number | null; stop_line?: number | null }) {
  const result = await query<ContextNoteRow>(
    `${accessibleNodesCte(3)}
     SELECT note.path, note.content, note.created_at, note.updated_at
       FROM task_context_notes note
       JOIN context_lineage ON context_lineage.id = note.context_node_id
      WHERE note.task_id = $1 AND note.path = $2
        AND (context_lineage.note_revision_limit IS NULL OR note.revision <= context_lineage.note_revision_limit)
      ORDER BY context_lineage.depth ASC, note.revision DESC
      LIMIT 1`,
    [state.taskId, input.path, state.contextNodeId]
  );
  const note = result.rows[0];
  if (!note) return { error: "Note file was not found." };
  const lines = note.content.split("\n");
  const resolveLine = (line: number | null | undefined, fallback: number) => line === null || line === undefined ? fallback : line < 0 ? lines.length + line + 1 : line;
  const start = Math.max(1, resolveLine(input.start_line, 1));
  const stop = Math.min(lines.length, Math.max(start, resolveLine(input.stop_line, lines.length)));
  return { path: note.path, content: lines.slice(start - 1, stop).join("\n"), start_line: start, stop_line: stop };
}

export async function searchContextNotes(state: ContextWindowRef, input: { query: string; path_prefix?: string | null; max_files?: number | null; max_matches_per_file?: number | null; recent_file_first?: boolean | null }) {
  const listed = await listContextNotes(state, { prefix: input.path_prefix, contains: input.query, max_results: input.max_files, file_order_by: "updated_at", file_order: input.recent_file_first ? "descending" : "ascending" });
  const matchesPerFile = limit(input.max_matches_per_file);
  const files = await Promise.all(listed.files.map(async (file) => {
    const note = await readContextNote(state, { path: file.path });
    const lines = typeof note.content === "string" ? note.content.split("\n") : [];
    const matches = lines.flatMap((line, index) => line.includes(input.query) ? [{ line: index + 1, content: line }] : []).slice(0, matchesPerFile);
    return matches.length > 0 ? { path: file.path, matches } : null;
  }));
  return { files: files.filter((file): file is NonNullable<typeof file> => file !== null) };
}

export async function mutateContextNote(state: ContextWindowRef, input: { path: string; text: string; append: boolean }) {
  return writeContextNote({ state, path: input.path, text: input.text, append: input.append });
}
