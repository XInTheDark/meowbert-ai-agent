import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { withTransaction } from "../../lib/db.js";
import { recordContextItems } from "../context-management-v2/index.js";
import type { AgentExecutionContext } from "./execution-types.js";

// Appends messages that arrived from outside the run (subagent mail, task reports) at a model-turn
// boundary. Pending tool calls are persisted first so the order survives a restart and replay.
export async function appendRunInboxItems(
  execution: AgentExecutionContext,
  claimItems: (client: PoolClient) => Promise<ResponseInputItem[]>
): Promise<void> {
  const state = execution.state;
  const result = await withTransaction(async (client) => {
    await client.query("SELECT id FROM tasks WHERE id = $1 FOR UPDATE", [execution.job.taskId]);
    const items = await claimItems(client);
    if (items.length === 0) return null;
    let leaf = state.currentLeafMessageId;
    const payloads = [
      ...(state.dispatchState.runPersistedItems.length ? [{ role: "assistant", items: [...state.dispatchState.runPersistedItems] }] : []),
      { role: "system", items }
    ];
    for (const payload of payloads) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO task_messages(id, task_id, role, content_json, parent_message_id)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [id, execution.job.taskId, payload.role, JSON.stringify({ text: "", response_items: payload.items }), leaf]
      );
      leaf = id;
    }
    return { leaf, items };
  });
  if (!result) return;
  state.currentLeafMessageId = result.leaf;
  state.dispatchState.runPersistedItems.splice(0);
  if (state.contextManagement.version === "v2") await recordContextItems(state.contextManagement, result.items);
  state.dispatchState.conversationItems.push(...result.items);
}
