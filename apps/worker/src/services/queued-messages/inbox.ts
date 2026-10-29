import type { AgentExecutionContext } from "@meowbert/run-executor/agent/execution-types";
import { mapMessagesForResponsesInput } from "@meowbert/run-executor/agent/utils";
import { query } from "../../lib/db.js";
import { appendRunInboxMessages } from "../agent/run-inbox.js";
import { announceQueuedMessagesDelivered, claimQueuedUserMessages } from "./claim.js";

// Delivers follow-ups the user sent while this run was working, after its last tool results and
// before the next model turn, so the run keeps going and its cached prompt prefix stays intact.
export async function appendQueuedUserMessages(execution: AgentExecutionContext): Promise<void> {
  const { prepared, job } = execution;
  // Checked without the task lock first, since almost every turn has nothing queued.
  const pending = await query("SELECT 1 FROM task_queued_messages WHERE task_id = $1 LIMIT 1", [job.taskId]);
  if ((pending.rowCount ?? 0) === 0) return;
  const delivered = await appendRunInboxMessages(
    execution,
    (client) => claimQueuedUserMessages(client, job.taskId),
    (rows) => mapMessagesForResponsesInput(rows, execution.taskInputDir, prepared.snapshot.image_detail ?? "high", {
      quickMode: prepared.quickMode,
      sendMetadataToModel: prepared.snapshot.send_metadata_to_model,
      ...(prepared.settings.sandboxPdfPreparation ? { pdfRuntime: { sandbox: prepared.sandbox, scratchDir: prepared.taskScratchDir } } : {})
    })
  );
  if (delivered) await announceQueuedMessagesDelivered(job.taskId);
}
