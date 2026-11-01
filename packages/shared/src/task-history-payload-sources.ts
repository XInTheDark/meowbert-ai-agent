import type { TaskArchiveSection } from "./task-history-archive-sections.js";

// Trusted SQL identifiers only. Warm values and cold references share one database snapshot.
const sources: Record<TaskArchiveSection, [string, string, string, string[]]> = {
  messages: ["task_messages", "task_id", "id", ["content_json", "token_usage_json"]],
  events: ["task_events", "task_id", "id", ["payload_json"]],
  message_revisions: ["task_message_revisions", "task_id", "id", ["old_content_json", "new_content_json"]],
  context_history: ["task_context_history_items", "task_id", "id", ["payload_json"]],
  context_notes: ["task_context_notes", "task_id", "id", ["content"]],
  window_prompts: ["task_context_windows", "task_id", "id", ["opening_prompt_json"]],
  window_requests: ["task_context_windows", "task_id", "id", ["request_state_json"]],
  subagent_sessions: ["task_subagent_sessions", "task_id", "task_id", ["runtime_json"]],
  subagent_mail: ["task_subagent_mail", "recipient_task_id", "id", ["body"]],
  subagent_waits: ["task_subagent_waits", "task_id", "task_id", ["resume_job_json"]],
  swarm_fork_seeds: ["task_swarm_fork_seeds", "swarm_task_id", "id", ["envelope_json", "tools_json", "items_json"]],
  swarm_notes: ["task_swarm_notes", "swarm_task_id", "seq", ["content"]],
  swarm_lane_results: ["task_swarm_lanes", "task_id", "task_id", ["result_json"]],
  media: ["task_media_blobs", "task_id", "sha256", ["mime_type"]],
  conversation_snapshots: ["task_conversation_snapshots", "task_id", "id", ["payload_json"]]
};

export function taskPayloadLocationSql(kind: TaskArchiveSection, messagePreview = false): string {
  const [table, owner, key, fields] = sources[kind];
  const values = kind === "messages" && messagePreview
    ? ["'content_json', jsonb_build_object('text', LEFT(COALESCE(hot.content_json->>'text', ''), 500), 'turn_summary', hot.content_json->'turn_summary')"]
    : fields.map((field) => `'${field}', hot.${field}`);
  const keyType = key === "seq" ? "bigint" : key === "sha256" ? "text" : "uuid";
  if (kind === "media") values.push("'bytes_base64', encode(hot.bytes, 'base64')");
  return `SELECT requested.id AS payload_id, payload.archive_key, task.task_history_state, task.task_history_archive_key,
    CASE WHEN payload.archive_key IS NULL AND hot.${key} IS NOT NULL
      THEN jsonb_build_object(${values.join(", ")}) END AS warm_payload
    FROM tasks task CROSS JOIN unnest($3::text[]) AS requested(id)
    LEFT JOIN task_history_payloads payload
      ON payload.task_id = task.id AND payload.kind = $2 AND payload.payload_id = requested.id
    LEFT JOIN ${table} hot ON hot.${owner} = task.id AND hot.${key} = requested.id::${keyType}
    WHERE task.id = $1`;
}
