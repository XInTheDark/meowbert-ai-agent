import type { TaskHistoryArchiveQueryable } from "./task-history-archive.js";
import { buildConversationTurns, conversationMapSchema, remapConversationMap, remapConversationOutline,
  type ConversationNavigation, type ConversationPublicMessage } from "./conversation-organization.js";

// OFFSET 0 keeps each step an index lookup instead of a rescan of the whole task per step.
export const CONVERSATION_ANCESTRY_SQL = `WITH RECURSIVE lineage AS (
  SELECT id, parent_message_id, 0 AS depth FROM task_messages WHERE task_id = $1 AND id = $2
  UNION ALL
  SELECT m.id, m.parent_message_id, l.depth + 1 FROM lineage l
  CROSS JOIN LATERAL (
    SELECT tm.id, tm.parent_message_id FROM task_messages tm
     WHERE tm.task_id = $1 AND tm.id = l.parent_message_id OFFSET 0
  ) m
)`;

export interface ConversationSnapshot {
  kind: "outline" | "map";
  payload_json: Record<string, unknown>;
  message_id: string;
}

export async function loadConversationSnapshots(db: TaskHistoryArchiveQueryable, taskId: string, leafId: string | null): Promise<ConversationSnapshot[]> {
  if (!leafId) return [];
  const result = await db.query<ConversationSnapshot>(`${CONVERSATION_ANCESTRY_SQL}
    SELECT DISTINCT ON (s.kind) s.id, s.kind, s.payload_json, s.message_id
    FROM task_conversation_snapshots s JOIN lineage l ON l.id = s.message_id
    WHERE s.task_id = $1 ORDER BY s.kind, l.depth ASC`, [taskId, leafId]);
  return db.readPayloads ? db.readPayloads(taskId, "conversation_snapshots", result.rows) : result.rows;
}

export async function loadConversationPublicIndex(db: TaskHistoryArchiveQueryable, taskId: string, leafId: string | null): Promise<ConversationPublicMessage[]> {
  if (!leafId) return [];
  const result = await db.query<Omit<ConversationPublicMessage, "text" | "summary"> & { content_json: Record<string, unknown> }>(`${CONVERSATION_ANCESTRY_SQL}
    SELECT m.id, m.role,
      jsonb_build_object('text', LEFT(COALESCE(m.content_json->>'text', ''), 500), 'turn_summary', m.content_json->'turn_summary') AS content_json,
      m.created_at, m.parent_message_id
    FROM lineage l JOIN task_messages m ON m.id = l.id
    WHERE m.role IN ('user', 'assistant') ORDER BY l.depth DESC`, [taskId, leafId]);
  const rows = db.readPayloads ? await db.readPayloads(taskId, "messages", result.rows, "message_preview") : result.rows;
  return rows.map(({ content_json, ...row }) => ({ ...row,
    text: String(content_json.text ?? "").slice(0, 500),
    summary: typeof content_json.turn_summary === "string" ? content_json.turn_summary : null
  }));
}

export async function loadConversationNavigation(db: TaskHistoryArchiveQueryable, taskId: string, leafId: string | null): Promise<ConversationNavigation> {
  const [snapshots, messages] = await Promise.all([
    loadConversationSnapshots(db, taskId, leafId), loadConversationPublicIndex(db, taskId, leafId)
  ]);
  const outline = snapshots.find((item) => item.kind === "outline");
  const map = snapshots.find((item) => item.kind === "map");
  return { enabled: true, active_leaf_message_id: leafId, turns: buildConversationTurns(messages), messages,
    outline: outline && typeof outline.payload_json.markdown === "string"
      ? { markdown: outline.payload_json.markdown, message_id: outline.message_id } : null,
    map: map ? { graph: conversationMapSchema.parse(map.payload_json), message_id: map.message_id } : null };
}

export async function saveConversationSnapshots(db: TaskHistoryArchiveQueryable, taskId: string, messageId: string,
  snapshots: Array<Pick<ConversationSnapshot, "kind" | "payload_json">>): Promise<void> {
  for (const snapshot of snapshots) await db.query(
    `INSERT INTO task_conversation_snapshots (task_id, message_id, kind, payload_json)
     VALUES ($1, $2, $3, $4::jsonb)`, [taskId, messageId, snapshot.kind, JSON.stringify(snapshot.payload_json)]);
}

export async function cloneConversationSnapshots(db: TaskHistoryArchiveQueryable, input: {
  sourceTaskId: string; sourceLeafId: string; targetTaskId: string; ids: Map<string, string>;
}): Promise<void> {
  const { rows: snapshots } = await db.query<ConversationSnapshot>(`${CONVERSATION_ANCESTRY_SQL}
    SELECT s.kind, s.payload_json, s.message_id FROM task_conversation_snapshots s
    JOIN lineage l ON l.id = s.message_id WHERE s.task_id = $1 ORDER BY l.depth DESC`,
  [input.sourceTaskId, input.sourceLeafId]);
  for (const snapshot of snapshots) {
    const messageId = input.ids.get(snapshot.message_id);
    if (!messageId) continue;
    const payload = snapshot.kind === "outline"
      ? { markdown: remapConversationOutline(String(snapshot.payload_json.markdown ?? ""), input.ids) }
      : remapConversationMap(conversationMapSchema.parse(snapshot.payload_json), input.ids);
    await saveConversationSnapshots(db, input.targetTaskId, messageId, [{ kind: snapshot.kind, payload_json: payload }]);
  }
}
