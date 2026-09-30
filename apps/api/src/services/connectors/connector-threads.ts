import { query } from "../../lib/db.js";

interface ConnectorThreadRow {
  id: string;
}

interface ConnectorMessageTaskRow {
  task_id: string;
}

export type ConnectorMessageDirection = "inbound" | "outbound";

interface FindConnectorThreadInput {
  bindingId: string;
  externalChatId: string;
  externalThreadId: string;
}

async function findConnectorThreadRow(input: FindConnectorThreadInput): Promise<ConnectorThreadRow | null> {
  const existing = await query<ConnectorThreadRow>(
    `SELECT id
       FROM connector_threads
      WHERE binding_id = $1
        AND external_chat_id = $2
        AND COALESCE(external_thread_id, '') = $3`,
    [input.bindingId, input.externalChatId, input.externalThreadId]
  );

  return existing.rows[0] ?? null;
}

export async function findConnectorThread(input: FindConnectorThreadInput): Promise<{ id: string } | null> {
  return findConnectorThreadRow(input);
}

export async function getOrCreateConnectorThread(input: {
  bindingId: string;
  workspaceId: string;
  externalChatId: string;
  externalThreadId: string;
}): Promise<{ id: string }> {
  const existing = await findConnectorThreadRow(input);
  if (existing) {
    await query(`UPDATE connector_threads SET last_seen_at = now() WHERE id = $1`, [existing.id]);
    return existing;
  }

  const created = await query<ConnectorThreadRow>(
    `INSERT INTO connector_threads (binding_id, external_chat_id, external_thread_id, workspace_id)
     VALUES ($1, $2, NULLIF($3, ''), $4)
     RETURNING id`,
    [input.bindingId, input.externalChatId, input.externalThreadId, input.workspaceId]
  );

  return created.rows[0];
}

// True while a Master is still working on the last thing this chat asked, so a mention-only
// chat can follow up without repeating the mention.
export async function isConnectorThreadMidConversation(threadId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1
       FROM tasks t
       JOIN project_masters pm ON pm.task_id = t.id
      WHERE t.connector_context_id = $1
        AND t.status IN ('queued', 'starting', 'running')
      LIMIT 1`,
    [threadId]
  );

  return (result.rowCount ?? 0) > 0;
}

// Channel/thread history is injected once, with a chat's first message to the Master.
export async function connectorThreadHasInboundMessages(threadId: string): Promise<boolean> {
  const result = await query(
    `SELECT 1
       FROM connector_message_links
      WHERE thread_id = $1
        AND direction = 'inbound'
      LIMIT 1`,
    [threadId]
  );

  return (result.rowCount ?? 0) > 0;
}

// Inbound links double as a dedupe record for providers that redeliver webhooks.
export async function resolveConnectorTaskFromExternalMessage(input: {
  threadId: string;
  workspaceId: string;
  externalMessageId: string;
}): Promise<string | null> {
  const result = await query<ConnectorMessageTaskRow>(
    `SELECT cml.task_id
       FROM connector_message_links cml
       JOIN tasks t ON t.id = cml.task_id
      WHERE cml.thread_id = $1
        AND cml.external_message_id = $2
        AND t.workspace_id = $3
      ORDER BY cml.created_at DESC
      LIMIT 1`,
    [input.threadId, input.externalMessageId, input.workspaceId]
  );

  return result.rows[0]?.task_id ?? null;
}

export async function upsertConnectorThreadMessageTaskLink(input: {
  threadId: string;
  externalMessageId: string;
  direction: ConnectorMessageDirection;
  taskId: string;
}): Promise<void> {
  await query(
    `INSERT INTO connector_message_links (thread_id, external_message_id, direction, task_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (thread_id, external_message_id)
     DO UPDATE SET
       direction = EXCLUDED.direction,
       task_id = EXCLUDED.task_id`,
    [input.threadId, input.externalMessageId, input.direction, input.taskId]
  );
}
