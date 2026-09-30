import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { AgentExecutionContext } from "../agent/execution-types.js";
import { appendRunInboxItems } from "../agent/run-inbox.js";
import { claimPendingMasterReports, formatMasterReport } from "./reports.js";

export async function appendProjectMasterInbox(execution: AgentExecutionContext): Promise<void> {
  if (!execution.prepared.isProjectMaster) return;
  await appendRunInboxItems(execution, async (client) => {
    const reports = await claimPendingMasterReports(client, execution.job.taskId);
    return reports.map((report): ResponseInputItem => ({ role: "user", content: formatMasterReport(report) }));
  });
}
