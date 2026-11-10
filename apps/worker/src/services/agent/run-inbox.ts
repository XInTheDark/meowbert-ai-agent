import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { withTransaction } from "../../lib/db.js";
import { applyRunInboxAppend } from "@meowbert/run-executor/agent-swarm/run-inbox";
import type { AgentExecutionContext } from "@meowbert/run-executor/agent/execution-types";
import type { TaskMessageRow } from "@meowbert/run-executor/agent/types";

export interface RunInboxMessage {
  role: "assistant" | "system" | "user";
  content: Record<string, unknown>;
  authorUserId?: string | null;
  metadata?: Record<string, unknown>;
}

async function insertInboxMessage(
  client: PoolClient,
  taskId: string,
  parentMessageId: string | null,
  message: RunInboxMessage
): Promise<TaskMessageRow> {
  const id = randomUUID();
  const inserted = await client.query<{ created_at: string }>(
    `INSERT INTO task_messages(id, task_id, role, content_json, parent_message_id, author_user_id, message_metadata_json)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb)
     RETURNING created_at`,
    [
      id, taskId, message.role, JSON.stringify(message.content), parentMessageId,
      message.authorUserId ?? null, message.metadata ? JSON.stringify(message.metadata) : null
    ]
  );
  return {
    id,
    role: message.role,
    content_json: message.content,
    message_metadata_json: message.metadata ?? null,
    parent_message_id: parentMessageId,
    edited_from_message_id: null,
    created_at: inserted.rows[0].created_at
  };
}

// Stores messages that arrived from outside the run on its branch, after the run's pending tool calls
// so the order survives a restart and replay. Caller holds the task lock in a transaction.
export async function insertRunInboxMessagesInTx(
  client: PoolClient,
  input: { taskId: string; leafMessageId: string | null; persistedItems: unknown[]; messages: RunInboxMessage[] }
): Promise<{ leaf: string; rows: TaskMessageRow[] } | null> {
  if (input.messages.length === 0) return null;
  let leaf = input.leafMessageId;
  if (input.persistedItems.length) {
    leaf = (await insertInboxMessage(client, input.taskId, leaf, {
      role: "assistant",
      content: { text: "", response_items: [...input.persistedItems] }
    })).id;
  }
  const rows: TaskMessageRow[] = [];
  for (const message of input.messages) {
    const row = await insertInboxMessage(client, input.taskId, leaf, message);
    rows.push(row);
    leaf = row.id;
  }
  return { leaf: leaf!, rows };
}

// Appends messages that arrived from outside the run (subagent mail, task reports, queued user
// follow-ups) at a model-turn boundary. `toItems` turns the stored messages into the model's input.
export async function appendRunInboxMessages(
  execution: AgentExecutionContext,
  claimMessages: (client: PoolClient) => Promise<RunInboxMessage[]>,
  toItems: (rows: TaskMessageRow[]) => Promise<ResponseInputItem[]>
): Promise<boolean> {
  const state = execution.state;
  const result = await withTransaction(async (client) => {
    await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [execution.job.taskId]);
    return insertRunInboxMessagesInTx(client, {
      taskId: execution.job.taskId,
      leafMessageId: state.currentLeafMessageId,
      persistedItems: state.dispatchState.runPersistedItems,
      messages: await claimMessages(client)
    });
  });
  if (!result) return false;
  await applyRunInboxAppend(execution, { leafMessageId: result.leaf, items: await toItems(result.rows) });
  return true;
}

export async function appendRunInboxItems(
  execution: AgentExecutionContext,
  claimItems: (client: PoolClient) => Promise<ResponseInputItem[]>
): Promise<void> {
  let claimed: ResponseInputItem[] = [];
  await appendRunInboxMessages(
    execution,
    async (client) => {
      claimed = await claimItems(client);
      return inboxItemsMessage(claimed);
    },
    async () => claimed
  );
}

// Items from outside the run, stored as one message the model reads as-is.
export function inboxItemsMessage(items: ResponseInputItem[]): RunInboxMessage[] {
  return items.length ? [{ role: "system", content: { text: "", response_items: items } }] : [];
}
