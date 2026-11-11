import { query } from "../../lib/db.js";
import { readTaskPayloads } from "../tasks/task-history-reader.js";

// Every message the user wrote on the current branch of the swarm's conversation, oldest first. The
// Check lane gets these and the deliverable, never the author's reasoning.
export async function loadBranchUserMessages(swarmTaskId: string, leafMessageId: string | null): Promise<string[]> {
  const result = await query<{ id: string; content_json: { text?: string } }>(
    `WITH RECURSIVE branch AS (
       SELECT id, parent_message_id, role, content_json, created_at, 0 AS level
         FROM task_messages
        WHERE task_id = $1 AND id = COALESCE($2::uuid,
          (SELECT id FROM task_messages WHERE task_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1))
       UNION ALL
       SELECT message.id, message.parent_message_id, message.role, message.content_json, message.created_at, branch.level + 1
         FROM branch CROSS JOIN LATERAL (
           SELECT tm.id, tm.parent_message_id, tm.role, tm.content_json, tm.created_at FROM task_messages tm
            WHERE tm.task_id = $1 AND tm.id = branch.parent_message_id OFFSET 0
         ) message
     )
     SELECT id, content_json FROM branch WHERE role = 'user' ORDER BY level DESC`,
    [swarmTaskId, leafMessageId]
  );
  const messages = await readTaskPayloads(swarmTaskId, "messages", result.rows);
  return messages.map((row) => row.content_json?.text?.trim() ?? "").filter((text) => text.length > 0);
}

// The spine of the parent's latest split, if it wrote one.
export async function loadLatestSpinePath(parentTaskId: string): Promise<string | null> {
  const result = await query<{ spine_path: string | null }>(
    `SELECT capabilities_json ->> 'spinePath' AS spine_path
       FROM task_swarm_fork_seeds
      WHERE source_task_id = $1 AND capabilities_json ->> 'spinePath' IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`,
    [parentTaskId]
  );
  return result.rows[0]?.spine_path ?? null;
}

// Check runs automatically once per user turn: when the leader replies after lanes were used since the
// user's last message, and no Check has run since then. The reply that follows the findings is
// delivered as it is, so Check never blocks delivery indefinitely.
export async function loadAutoCheckFiles(leaderTaskId: string): Promise<string[] | null> {
  const result = await query<{ kind: string; files: Array<{ path?: unknown }> | null }>(
    `SELECT lane.kind, lane.result_json -> 'files' AS files
       FROM task_swarm_lanes lane
      WHERE lane.parent_task_id = $1
        AND GREATEST(lane.created_at, COALESCE(lane.merged_at, lane.created_at)) > COALESCE(
          (SELECT MAX(created_at) FROM task_messages WHERE task_id = $1 AND role = 'user'), '-infinity'::timestamptz)`,
    [leaderTaskId]
  );
  if (result.rows.length === 0 || result.rows.some((row) => row.kind === "check")) return null;
  return [...new Set(result.rows.flatMap((row) => (row.files ?? [])
    .map((file) => file.path)
    .filter((filePath): filePath is string => typeof filePath === "string")))];
}
