import { query } from "../../lib/db.js";
import type { SwarmBudgetState } from "@meowbert/run-executor/agent-swarm/budget";
import type { SwarmRunContext } from "./config.js";

export {
  judgeBudget,
  LANE_SHARE_SPENT_REASON,
  SWARM_BUDGET_SPENT_REASON,
  SWARM_DEADLINE_REASON,
  type BudgetVerdict
} from "@meowbert/run-executor/agent-swarm/budget";

// Spending while a swarm runs; shares are handed out in budget-shares.ts and verdicts are judged by
// the run (agent-swarm/budget in the executor).

// Weighted tokens of each model response go to the swarm and to the lane that spent them, in one
// statement. There are no reservations.
export async function chargeSwarmStep(swarm: Pick<SwarmRunContext, "swarmTaskId" | "settings">, taskId: string, weightedTokens: number | null): Promise<void> {
  if (!swarm.settings.budgetsEnabled || !weightedTokens || weightedTokens <= 0) return;
  const tokens = Math.ceil(weightedTokens);
  await query(
    `WITH charged_swarm AS (
       UPDATE task_swarms SET spent_tokens = spent_tokens + $2, updated_at = now() WHERE task_id = $1 RETURNING task_id
     )
     UPDATE task_swarm_lanes SET spent_tokens = spent_tokens + $2, updated_at = now()
      WHERE task_id = $3 AND EXISTS (SELECT 1 FROM charged_swarm)`,
    [swarm.swarmTaskId, tokens, taskId]
  );
}

export async function loadBudgetState(swarm: Pick<SwarmRunContext, "swarmTaskId">, taskId: string): Promise<SwarmBudgetState | null> {
  const result = await query<SwarmBudgetState>(
    `SELECT swarm.token_budget, swarm.reserve_tokens, swarm.spent_tokens::text AS swarm_spent,
            COALESCE(swarm.deadline_at <= now(), false) AS deadline_passed,
            lane.share_tokens, lane.spent_tokens::text AS lane_spent, lane.wrap_up_notified,
            (SELECT COALESCE(SUM(child.share_tokens), 0) FROM task_swarm_lanes child WHERE child.parent_task_id = $2)::text AS given
       FROM task_swarms swarm
       LEFT JOIN task_swarm_lanes lane ON lane.task_id = $2
      WHERE swarm.task_id = $1`,
    [swarm.swarmTaskId, taskId]
  );
  return result.rows[0] ?? null;
}

export async function markWrapUpNotified(laneTaskId: string): Promise<void> {
  await query("UPDATE task_swarm_lanes SET wrap_up_notified = true, updated_at = now() WHERE task_id = $1", [laneTaskId]);
}
