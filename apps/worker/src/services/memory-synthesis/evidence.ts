import { readTaskEvidenceArgumentsSchema } from "@meowbert/run-executor/agent-tools/memory-evidence";
import type { TaskEvidenceInput, TaskEvidenceOutput } from "@meowbert/run-executor/agent/ports/platform-tools";
import { query } from "../../lib/db.js";
import { readTaskPayloads } from "../tasks/task-history-reader.js";
import { memoryExcludedTasksCte } from "./delta-source.js";

const PAGE_SIZE = 5;
const CONTENT_CHARS = 4_000;
interface EvidenceRow {
  id: string;
  role: "user" | "assistant" | "tool";
  parent_message_id: string | null;
  created_at: string | Date;
  content_json: Record<string, unknown>;
}

async function assertEvidenceTask(taskId: string, environmentId: string): Promise<void> {
  const result = await query(
    `WITH RECURSIVE ${memoryExcludedTasksCte("$2")}
     SELECT id FROM tasks t
      WHERE t.id = $1 AND t.environment_id = $2 AND t.trashed_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM memory_excluded_tasks excluded WHERE excluded.id = t.id)`,
    [taskId, environmentId]
  );
  if (!result.rows.length) throw new Error("Task not found or not accessible for Memory evidence.");
}

function evidenceItem(row: EvidenceRow, offset: number): TaskEvidenceOutput["items"][number] {
  const content = row.role === "tool" ? JSON.stringify(row.content_json) : String(row.content_json.text ?? "");
  return {
    message_id: row.id,
    parent_message_id: row.parent_message_id,
    role: row.role,
    created_at: new Date(row.created_at).toISOString(),
    content: content.slice(offset, offset + CONTENT_CHARS),
    offset_chars: offset,
    next_offset_chars: offset + CONTENT_CHARS < content.length ? offset + CONTENT_CHARS : null
  };
}

export async function readTaskEvidence(input: TaskEvidenceInput, environmentId: string): Promise<TaskEvidenceOutput> {
  const args = readTaskEvidenceArgumentsSchema.parse(input);
  await assertEvidenceTask(args.task_id, environmentId);
  const referenceId = args.message_id ?? args.before_message_id;
  if (referenceId) {
    const reference = await query("SELECT id FROM task_messages WHERE task_id = $1 AND id = $2 AND role IN ('user', 'assistant', 'tool')", [args.task_id, referenceId]);
    if (!reference.rows.length) throw new Error("Source message not found in this task.");
  }
  const result = await query<EvidenceRow>(
    `SELECT m.id, m.role, m.parent_message_id, m.created_at, m.content_json
       FROM task_messages m
      WHERE m.task_id = $1 AND m.role IN ('user', 'assistant', 'tool')
        AND ($2::uuid IS NULL OR m.id = $2)
        AND ($3::uuid IS NULL OR (m.created_at, m.id) < (
          SELECT created_at, id FROM task_messages WHERE task_id = $1 AND id = $3))
      ORDER BY m.created_at DESC, m.id DESC LIMIT $4`,
    [args.task_id, args.message_id, args.before_message_id, args.message_id ? 1 : PAGE_SIZE + 1]
  );
  const rows = await readTaskPayloads(args.task_id, "messages", result.rows.slice(0, PAGE_SIZE));
  return {
    task_id: args.task_id,
    items: rows.map((row) => evidenceItem(row, args.offset_chars ?? 0)),
    next_before_message_id: result.rows.length > PAGE_SIZE ? rows.at(-1)?.id ?? null : null
  };
}
