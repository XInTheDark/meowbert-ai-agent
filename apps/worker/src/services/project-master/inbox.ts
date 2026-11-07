import type { ResponseInputItem } from "openai/resources/responses/responses";
import { claimProjectMapChanges, formatProjectMapChanges } from "@meowbert/shared";
import type { AgentExecutionContext } from "@meowbert/run-executor/agent/execution-types";
import { appendRunInboxItems } from "../agent/run-inbox.js";
import { claimPendingMasterReports, formatMasterReport } from "./reports.js";

// Task reports and members' map edits reach the Master at its next model turn. Map edits come
// first so reports are read against the current map.
export async function appendProjectMasterInbox(execution: AgentExecutionContext): Promise<void> {
  if (!execution.prepared.isProjectMaster) return;
  await appendRunInboxItems(execution, async (client) => {
    const changes = await claimProjectMapChanges(client, execution.job.environmentId);
    const reports = await claimPendingMasterReports(client, execution.job.taskId, execution.prepared.runActorUserId);
    return [
      ...(changes.length ? [{ role: "user", content: formatProjectMapChanges(changes) } satisfies ResponseInputItem] : []),
      ...reports.map((report): ResponseInputItem => ({ role: "user", content: formatMasterReport(report) }))
    ];
  });
}
