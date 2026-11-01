import type { TaskHistoryArchiveQueryable } from "./task-history-archive.js";

const restores = {
  messages: ["task_messages", [["content_json", "jsonb"], ["token_usage_json", "jsonb"]]],
  events: ["task_events", [["payload_json", "jsonb"]]],
  message_revisions: ["task_message_revisions", [["old_content_json", "jsonb"], ["new_content_json", "jsonb"]]],
  context_history: ["task_context_history_items", [["payload_json", "jsonb"]]],
  context_notes: ["task_context_notes", [["content", "text"]]],
  window_prompts: ["task_context_windows", [["opening_prompt_json", "jsonb"]]],
  window_requests: ["task_context_windows", [["request_state_json", "jsonb"]]]
} as const;

export async function restoreTaskArchiveRecords(client: TaskHistoryArchiveQueryable, taskId: string,
  kind: keyof typeof restores, rows: object[]): Promise<void> {
  const [table, fields] = restores[kind];
  let batch: string[] = []; let bytes = 2;
  const flush = async (): Promise<void> => {
    if (!batch.length) return;
    await client.query(
      `UPDATE ${table} target SET ${fields.map(([field]) => `${field} = item.${field}`).join(", ")}
        FROM jsonb_to_recordset($2::jsonb) AS item(id uuid, ${fields.map(([field, type]) => `${field} ${type}`).join(", ")})
        WHERE target.task_id = $1 AND target.id = item.id`, [taskId, `[${batch.join(",")}]`]);
    batch = []; bytes = 2;
  };
  for (const row of rows) {
    const serialized = JSON.stringify(row); const size = Buffer.byteLength(serialized) + 1;
    if (batch.length >= 128 || (batch.length && bytes + size > 2_000_000)) await flush();
    batch.push(serialized); bytes += size;
  }
  await flush();
}
