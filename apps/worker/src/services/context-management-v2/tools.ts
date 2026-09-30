import { query } from "../../lib/db.js";
import type { ContextHistoryRow, ContextManagementV2State, ContextNoteRow, ContextWindowRow } from "./types.js";
import { accessibleNodesCte, writeContextNote } from "./service.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function limit(value: number | null | undefined): number {
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value ?? DEFAULT_LIMIT)));
}

function truncate(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}\n...[truncated ${value.length - maximum} chars]`;
}

function itemText(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload);
}

export async function listContextWindows(state: ContextManagementV2State, input: { limit?: number | null; recent_first?: boolean | null }) {
  const result = await query<{ id: string; item_count: number }>(
    `${accessibleNodesCte(2)}
     SELECT w.id, COUNT(i.id)::integer AS item_count
       FROM task_context_windows w
       JOIN context_lineage ON context_lineage.id = w.context_node_id
       LEFT JOIN task_context_history_items i ON i.window_id = w.id
      WHERE w.task_id = $1
      GROUP BY w.id, w.ordinal
      ORDER BY w.ordinal ${input.recent_first ? "DESC" : "ASC"}
      LIMIT $3`,
    [state.taskId, state.contextNodeId, limit(input.limit)]
  );
  return { windows: result.rows.map((row) => ({ window_id: row.id, item_count: row.item_count })) };
}

export async function listContextItems(state: ContextManagementV2State, input: {
  limit?: number | null;
  recent_first?: boolean | null;
  role?: string | null;
  tool_namespace?: string | null;
  tool_name?: string | null;
  window_id?: string | null;
  max_chars_per_item?: number | null;
}) {
  const result = await query<ContextHistoryRow>(
    `${accessibleNodesCte(7)}
     SELECT i.id, i.ordinal, i.role, i.item_type, i.tool_namespace, i.tool_name, i.payload_json, i.created_at
       FROM task_context_history_items i
       JOIN task_context_windows w ON w.id = i.window_id
       JOIN context_lineage ON context_lineage.id = i.context_node_id
      WHERE i.task_id = $1
        AND ($2::uuid IS NULL OR i.window_id = $2::uuid)
        AND ($3::text IS NULL OR i.role = $3)
        AND ($4::text IS NULL OR i.tool_namespace = $4)
        AND ($5::text IS NULL OR i.tool_name = $5)
      ORDER BY w.ordinal ${input.recent_first ? "DESC" : "ASC"}, i.ordinal ${input.recent_first ? "DESC" : "ASC"}
      LIMIT $6`,
    [state.taskId, input.window_id ?? null, input.role ?? null, input.tool_namespace ?? null, input.tool_name ?? null, limit(input.limit), state.contextNodeId]
  );
  const maxChars = Math.min(100_000, Math.max(1, Math.floor(input.max_chars_per_item ?? 2_000)));
  return {
    items: result.rows.map((row) => ({
      item_id: row.id,
      role: row.role,
      tool_namespace: row.tool_namespace,
      tool_name: row.tool_name,
      truncated_content: `${truncate(itemText(row.payload_json), maxChars)}\n[id: ${row.id}]`
    }))
  };
}

export async function readContextItem(state: ContextManagementV2State, input: {
  window_id: string;
  item_id: string;
  offset_chars?: number | null;
  limit_chars?: number | null;
}) {
  const result = await query<ContextHistoryRow>(
    `${accessibleNodesCte(4)}
     SELECT i.id, i.ordinal, i.role, i.item_type, i.tool_namespace, i.tool_name, i.payload_json, i.created_at
       FROM task_context_history_items i
       JOIN context_lineage ON context_lineage.id = i.context_node_id
      WHERE i.task_id = $1 AND i.window_id = $2 AND i.id = $3`,
    [state.taskId, input.window_id, input.item_id, state.contextNodeId]
  );
  const row = result.rows[0];
  if (!row) return { error: "History item was not found." };
  const text = itemText(row.payload_json);
  const offset = Math.max(0, Math.floor(input.offset_chars ?? 0));
  const length = Math.min(100_000, Math.max(1, Math.floor(input.limit_chars ?? 10_000)));
  return { item_id: row.id, content: text.slice(offset, offset + length), offset_chars: offset, total_chars: text.length };
}

export async function searchContextHistory(state: ContextManagementV2State, input: {
  query: string;
  limit?: number | null;
  recent_first?: boolean | null;
  role?: string | null;
  tool_namespace?: string | null;
  tool_name?: string | null;
  window_id?: string | null;
}) {
  const result = await query<ContextHistoryRow>(
    `${accessibleNodesCte(7)}
     SELECT i.id, i.ordinal, i.role, i.item_type, i.tool_namespace, i.tool_name, i.payload_json, i.created_at
       FROM task_context_history_items i
       JOIN task_context_windows w ON w.id = i.window_id
       JOIN context_lineage ON context_lineage.id = i.context_node_id
      WHERE i.task_id = $1
        AND i.payload_json::text LIKE '%' || $2 || '%'
        AND ($3::uuid IS NULL OR i.window_id = $3::uuid)
        AND ($4::text IS NULL OR i.role = $4)
        AND ($5::text IS NULL OR i.tool_namespace = $5)
        AND ($6::text IS NULL OR i.tool_name = $6)
      ORDER BY w.ordinal ${input.recent_first ? "DESC" : "ASC"}, i.ordinal ${input.recent_first ? "DESC" : "ASC"}
      LIMIT $8`,
    [state.taskId, input.query, input.window_id ?? null, input.role ?? null, input.tool_namespace ?? null, input.tool_name ?? null, state.contextNodeId, limit(input.limit)]
  );
  return {
    items: result.rows.map((row) => ({
      item_id: row.id,
      role: row.role,
      tool_namespace: row.tool_namespace,
      tool_name: row.tool_name,
      truncated_content: `${truncate(itemText(row.payload_json), 2_000)}\n[id: ${row.id}]`
    }))
  };
}

export async function listContextNotes(state: ContextManagementV2State, input: {
  prefix?: string | null;
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
        ORDER BY note.path, context_lineage.depth ASC, note.revision DESC
     )
     SELECT path, content, created_at, updated_at
       FROM effective_notes
      WHERE ($2::text IS NULL OR path LIKE $2 || '%')
      ORDER BY ${field} ${direction}
      LIMIT $3`,
    [state.taskId, input.prefix ?? null, limit(input.max_results), state.contextNodeId]
  );
  return { files: result.rows.map((note) => ({ path: note.path, bytes: Buffer.byteLength(note.content, "utf8"), created_at: note.created_at, updated_at: note.updated_at })) };
}

export async function readContextNote(state: ContextManagementV2State, input: { path: string; start_line?: number | null; stop_line?: number | null }) {
  const result = await query<ContextNoteRow>(
    `${accessibleNodesCte(3)}
     SELECT note.path, note.content, note.created_at, note.updated_at
       FROM task_context_notes note
       JOIN context_lineage ON context_lineage.id = note.context_node_id
      WHERE note.task_id = $1 AND note.path = $2
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

export async function searchContextNotes(state: ContextManagementV2State, input: { query: string; path_prefix?: string | null; max_files?: number | null; max_matches_per_file?: number | null; recent_file_first?: boolean | null }) {
  const listed = await listContextNotes(state, { prefix: input.path_prefix, max_results: input.max_files, file_order_by: "updated_at", file_order: input.recent_file_first ? "descending" : "ascending" });
  const matchesPerFile = limit(input.max_matches_per_file);
  const files = await Promise.all(listed.files.map(async (file) => {
    const note = await readContextNote(state, { path: file.path });
    const lines = typeof note.content === "string" ? note.content.split("\n") : [];
    const matches = lines.flatMap((line, index) => line.includes(input.query) ? [{ line: index + 1, content: line }] : []).slice(0, matchesPerFile);
    return matches.length > 0 ? { path: file.path, matches } : null;
  }));
  return { files: files.filter((file): file is NonNullable<typeof file> => file !== null) };
}

export async function mutateContextNote(state: ContextManagementV2State, input: { path: string; text: string; append: boolean }) {
  return writeContextNote({ state, path: input.path, text: input.text, append: input.append });
}
