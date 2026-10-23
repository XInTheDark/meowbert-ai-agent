import { withTransaction } from "../../lib/db.js";
import { isTaskRunLatestAttempt } from "../agent-db/index.js";
import type { LoadedWorkflowRunContext } from "./context-types.js";

// Marks a Long Horizon workflow completed once its main agent delivers. Returns false when it was
// already completed or a newer attempt of the run has started.
export async function markWorkflowCompleted(
  context: LoadedWorkflowRunContext,
  options: { currentRunId?: string | null } = {}
): Promise<boolean> {
  const nextStateJson = {
    currentRound: context.longHorizon?.latestRound ?? 0,
    approvedRound: context.longHorizon?.approvedRound ?? null
  };

  return withTransaction(async (client) => {
    const workflowResult = await client.query<{ task_id: string; phase?: string }>(
      `SELECT task_id, phase
         FROM task_workflows
        WHERE task_id = $1
        FOR UPDATE`,
      [context.workflowTaskId]
    );
    if (workflowResult.rows[0]?.phase === "completed") return false;

    if (options.currentRunId && !(await isTaskRunLatestAttempt(context.taskId, options.currentRunId))) {
      return false;
    }

    await client.query(
      `UPDATE task_workflows
          SET phase = 'completed',
              state_json = $2::jsonb,
              updated_at = now()
        WHERE task_id = $1`,
      [context.workflowTaskId, JSON.stringify(nextStateJson)]
    );
    return true;
  });
}
