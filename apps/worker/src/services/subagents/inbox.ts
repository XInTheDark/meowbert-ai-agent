import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { AgentExecutionContext } from "../agent/execution-types.js";
import { appendRunInboxItems } from "../agent/run-inbox.js";

export async function appendSubagentInbox(execution: AgentExecutionContext): Promise<void> {
  if (!execution.allowSubtaskTools && !execution.prepared.isSubtask) return;
  await appendRunInboxItems(execution, async (client) => {
    const mail = await client.query<{ id: string; sender_task_id: string | null; kind: string; body: string }>(
      `SELECT id, sender_task_id, kind, body FROM task_subagent_mail
       WHERE recipient_task_id = $1 AND delivered_at IS NULL ORDER BY created_at, id LIMIT 20 FOR UPDATE`,
      [execution.job.taskId]
    );
    if (!mail.rows.length) return [];
    await client.query("UPDATE task_subagent_mail SET delivered_at = now(), wake = false WHERE id = ANY($1::uuid[])",
      [mail.rows.map((message) => message.id)]);
    return mail.rows.map((message): ResponseInputItem => ({
      role: "user", content: `[Subagent ${message.kind}; sender=${message.sender_task_id ?? "runtime"}; message=${message.id}]\n${message.body}`
    }));
  });
}
