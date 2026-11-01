import type { TaskHistoryArchiveQueryable } from "./task-history-archive.js";
import type { ArchivePayload, TaskArchiveSection } from "./task-history-archive-sections.js";

export function taskHistorySegmentEligibilitySql(cutoff: "$1" | "$2"): string {
  return `(
   EXISTS (SELECT 1 FROM task_context_windows w
     WHERE w.task_id = t.id AND w.closed_at < ${cutoff}::timestamptz AND (
       EXISTS (SELECT 1 FROM task_context_history_items item WHERE item.window_id = w.id
         AND NOT EXISTS (SELECT 1 FROM task_history_payloads p WHERE p.task_id = t.id AND p.kind = 'context_history' AND p.payload_id = item.id::text))
       OR (w.opening_prompt_json IS NOT NULL AND NOT EXISTS (SELECT 1 FROM task_history_payloads p WHERE p.task_id = t.id AND p.kind = 'window_prompts' AND p.payload_id = w.id::text))
       OR (w.request_state_json IS NOT NULL AND NOT EXISTS (SELECT 1 FROM task_history_payloads p WHERE p.task_id = t.id AND p.kind = 'window_requests' AND p.payload_id = w.id::text))))
   OR EXISTS (SELECT 1 FROM task_messages message WHERE message.task_id = t.id AND message.created_at < ${cutoff}::timestamptz
     AND (message.created_at, message.id) < (SELECT recent.created_at, recent.id FROM task_messages recent
       WHERE recent.task_id = t.id ORDER BY recent.created_at DESC, recent.id DESC OFFSET 127 LIMIT 1)
     AND NOT EXISTS (SELECT 1 FROM task_history_payloads p WHERE p.task_id = t.id AND p.kind = 'messages' AND p.payload_id = message.id::text)
     AND NOT EXISTS (SELECT 1 FROM task_runs run WHERE run.task_id = t.id AND run.ended_at IS NULL AND run.started_at <= message.created_at))
 )`;
}

export const TASK_HISTORY_SEGMENT_CANDIDATE_SQL = `SELECT t.id FROM tasks t
 WHERE t.task_history_state = 'warm' AND t.task_history_archive_failed_attempts < 3
   AND ${taskHistorySegmentEligibilitySql("$1")}
 ORDER BY t.task_history_last_active_at, t.id LIMIT 1`;

export async function loadArchiveSegments(client: TaskHistoryArchiveQueryable, taskId: string, cutoff: string): Promise<Partial<Record<TaskArchiveSection, ArchivePayload[]>>> {
  const messages = await client.query<ArchivePayload>(
    `SELECT m.id, m.role, m.content_json, m.token_usage_json FROM task_messages m
      WHERE m.task_id = $1 AND m.created_at < $2::timestamptz
        AND (m.created_at, m.id) < (SELECT created_at, id FROM task_messages WHERE task_id = $1 ORDER BY created_at DESC, id DESC OFFSET 127 LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM task_history_payloads p WHERE p.task_id = $1 AND p.kind = 'messages' AND p.payload_id = m.id::text)
        AND NOT EXISTS (SELECT 1 FROM task_runs r WHERE r.task_id = $1 AND r.ended_at IS NULL AND r.started_at <= m.created_at)
      ORDER BY m.created_at, m.id LIMIT 128 FOR UPDATE`, [taskId, cutoff]);
  const windows = await client.query<{ id: string }>(
    `SELECT w.id FROM task_context_windows w WHERE w.task_id = $1 AND w.closed_at < $2::timestamptz
       AND (EXISTS (SELECT 1 FROM task_context_history_items i WHERE i.window_id = w.id AND NOT EXISTS (
         SELECT 1 FROM task_history_payloads p WHERE p.task_id = $1 AND p.kind = 'context_history' AND p.payload_id = i.id::text))
       OR (w.opening_prompt_json IS NOT NULL AND NOT EXISTS (SELECT 1 FROM task_history_payloads p WHERE p.task_id = $1 AND p.kind = 'window_prompts' AND p.payload_id = w.id::text))
       OR (w.request_state_json IS NOT NULL AND NOT EXISTS (SELECT 1 FROM task_history_payloads p WHERE p.task_id = $1 AND p.kind = 'window_requests' AND p.payload_id = w.id::text)))
      ORDER BY w.closed_at, w.id LIMIT 1 FOR UPDATE`, [taskId, cutoff]);
  const window = windows.rows[0]?.id;
  const sections: Partial<Record<TaskArchiveSection, ArchivePayload[]>> = { messages: messages.rows };
  if (!window) return sections;
  sections.context_history = (await client.query<ArchivePayload>(
    `SELECT id, payload_json FROM task_context_history_items i WHERE task_id = $1 AND window_id = $2
      AND NOT EXISTS (SELECT 1 FROM task_history_payloads p WHERE p.task_id = $1 AND p.kind = 'context_history' AND p.payload_id = i.id::text)
      ORDER BY ordinal LIMIT 128 FOR UPDATE`, [taskId, window])).rows;
  for (const [kind, column] of [["window_prompts", "opening_prompt_json"], ["window_requests", "request_state_json"]] as const) {
    sections[kind] = (await client.query<ArchivePayload>(
      `SELECT id, ${column} FROM task_context_windows w WHERE task_id = $1 AND id = $2 AND ${column} IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM task_history_payloads p WHERE p.task_id = $1 AND p.kind = $3 AND p.payload_id = w.id::text)`, [taskId, window, kind])).rows;
  }
  return sections;
}

const payloadColumns = {
  context_history: ["task_context_history_items", "payload_json", "'{}'::jsonb"],
  window_prompts: ["task_context_windows", "opening_prompt_json", "NULL"],
  window_requests: ["task_context_windows", "request_state_json", "NULL"]
} as const;

export async function stubArchiveSegment(client: TaskHistoryArchiveQueryable, taskId: string, kind: TaskArchiveSection, items: ArchivePayload[], cutoff: string): Promise<string[]> {
  if (!items.length) return [];
  if (kind === "messages") {
    const result = await client.query<{ id: string }>(
      `UPDATE task_messages m SET content_json = item.stub, token_usage_json = NULL
        FROM jsonb_to_recordset($2::jsonb) AS item(id uuid, content_json jsonb, token_usage_json jsonb, stub jsonb)
        WHERE m.task_id = $1 AND m.id = item.id AND m.content_json = item.content_json
          AND m.token_usage_json IS NOT DISTINCT FROM item.token_usage_json
          AND NOT EXISTS (SELECT 1 FROM task_runs r WHERE r.task_id = $1 AND r.ended_at IS NULL AND r.started_at <= m.created_at)
        RETURNING m.id`, [taskId, JSON.stringify(items)]);
    return result.rows.map((row) => row.id);
  }
  if (!(kind in payloadColumns)) throw new Error(`Unsupported archive segment: ${kind}`);
  const [table, column, stub] = payloadColumns[kind as keyof typeof payloadColumns];
  const closed = kind === "context_history"
    ? "EXISTS (SELECT 1 FROM task_context_windows w WHERE w.id = target.window_id AND w.closed_at < $3::timestamptz)"
    : "target.closed_at < $3::timestamptz";
  const result = await client.query<{ id: string }>(
    `UPDATE ${table} target SET ${column} = ${stub}
      FROM jsonb_to_recordset($2::jsonb) AS item(id uuid, ${column} jsonb)
      WHERE target.task_id = $1 AND target.id = item.id AND target.${column} = item.${column} AND ${closed} RETURNING target.id`,
    [taskId, JSON.stringify(items), cutoff]);
  return result.rows.map((row) => row.id);
}
