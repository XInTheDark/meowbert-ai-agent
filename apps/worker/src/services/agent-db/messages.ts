import { saveConversationSnapshots, remapConversationMap, remapConversationOutline, conversationMapSchema, type ConversationSnapshot, type TaskHistoryArchiveQueryable } from "@meowbert/shared";
import { createTaskMessageMetadata, touchTaskHistoryActivity } from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import type { TaskMessageRow } from "../agent/types.js";

export async function appendMessage(
  taskId: string,
  role: "user" | "assistant" | "system" | "tool",
  payload: Record<string, unknown>,
  options: {
    client?: TaskHistoryArchiveQueryable;
    organizationSnapshots?: Array<Pick<ConversationSnapshot, "kind" | "payload_json">>;
    parentMessageId?: string | null;
    editedFromMessageId?: string | null;
    createdAt?: string | null;
    agentId?: string | null;
    reasoningContentCount?: number | null;
  } = {}
): Promise<string> {
  if (options.organizationSnapshots?.length && !options.client) {
    return withTransaction((client) => appendMessage(taskId, role, payload, { ...options, client }));
  }
  const db: TaskHistoryArchiveQueryable = options.client ?? { query };
  const createdAt = options.createdAt ?? new Date().toISOString();
  const messageMetadata = role === "tool"
    ? null
    : createTaskMessageMetadata(createdAt, {
        agentId: role === "assistant" ? options.agentId : null,
        reasoningContentCount: role === "assistant" ? options.reasoningContentCount : null
      });
  const result = await db.query<{ id: string }>(
    `INSERT INTO task_messages (
      task_id,
      role,
      content_json,
      message_metadata_json,
      parent_message_id,
      edited_from_message_id,
      created_at
    )
    VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7)
    RETURNING id`,
    [
      taskId,
      role,
      JSON.stringify(payload),
      messageMetadata ? JSON.stringify(messageMetadata) : null,
      options.parentMessageId ?? null,
      options.editedFromMessageId ?? null,
      createdAt
    ]
  );
  const messageId = result.rows[0].id;
  if (options.organizationSnapshots?.length) {
    const ids = new Map([["current", messageId]]);
    await saveConversationSnapshots(db, taskId, messageId, options.organizationSnapshots.map((snapshot) => ({
      kind: snapshot.kind,
      payload_json: snapshot.kind === "outline"
        ? { markdown: remapConversationOutline(String(snapshot.payload_json.markdown), ids) }
        : remapConversationMap(conversationMapSchema.parse(snapshot.payload_json), ids)
    })));
  }
  await touchTaskHistoryActivity(
    db,
    taskId,
    createdAt
  );
  return result.rows[0].id;
}

export async function getNewestLeafMessageId(taskId: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    `SELECT tm.id
       FROM task_messages tm
      WHERE tm.task_id = $1
        AND NOT EXISTS (
          SELECT 1
            FROM task_messages child
           WHERE child.task_id = tm.task_id
             AND child.parent_message_id = tm.id
        )
      ORDER BY tm.created_at DESC, tm.id DESC
      LIMIT 1`,
    [taskId]
  );
  return result.rows[0]?.id ?? null;
}

export async function resolveNewestDescendantLeafMessageId(taskId: string, messageId: string): Promise<string | null> {
  const result = await query<{ id: string }>(
    `WITH RECURSIVE branch_messages AS (
        SELECT tm.id, tm.created_at
          FROM task_messages tm
         WHERE tm.task_id = $1
           AND tm.id = $2
        UNION ALL
        SELECT child.id, child.created_at
          FROM task_messages child
          JOIN branch_messages bm
            ON child.parent_message_id = bm.id
         WHERE child.task_id = $1
      )
      SELECT bm.id
        FROM branch_messages bm
       WHERE NOT EXISTS (
         SELECT 1
           FROM task_messages child
          WHERE child.task_id = $1
            AND child.parent_message_id = bm.id
       )
       ORDER BY bm.created_at DESC, bm.id DESC
       LIMIT 1`,
    [taskId, messageId]
  );

  return result.rows[0]?.id ?? null;
}

export async function loadBranchPathMessages(taskId: string, leafMessageId: string): Promise<TaskMessageRow[]> {
  const pathRes = await query<TaskMessageRow>(
    `WITH RECURSIVE lineage AS (
      SELECT
        id,
        role,
        content_json,
        message_metadata_json,
        parent_message_id,
        edited_from_message_id,
        created_at,
        0 AS depth
      FROM task_messages
      WHERE task_id = $1
        AND id = $2
      UNION ALL
      SELECT
        tm.id,
        tm.role,
        tm.content_json,
        tm.message_metadata_json,
        tm.parent_message_id,
        tm.edited_from_message_id,
        tm.created_at,
        lineage.depth + 1 AS depth
      FROM task_messages tm
      JOIN lineage
        ON lineage.parent_message_id = tm.id
      WHERE tm.task_id = $1
    )
    SELECT
      id,
      role,
      content_json,
      message_metadata_json,
      parent_message_id,
      edited_from_message_id,
      created_at
    FROM lineage
    ORDER BY depth DESC`,
    [taskId, leafMessageId]
  );
  return pathRes.rows;
}
