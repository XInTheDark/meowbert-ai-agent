import { query } from "../../lib/db.js";
import type { AgentExecutionContext } from "../agent/execution-types.js";
import type { SwarmRunContext } from "./config.js";
import { buildLaneWrapUpNote, LEADER_BUDGET_SPENT_NOTE, LEADER_DEADLINE_NOTE } from "./prompt.js";

// Budget enforcement while a swarm runs; shares are handed out in budget-shares.ts. Only when
// budgets are on: otherwise a swarm is bounded by fan-out, depth, the running-lane cap and step limits.

interface BudgetState {
  token_budget: string | null;
  reserve_tokens: string;
  swarm_spent: string;
  deadline_passed: boolean;
  share_tokens: string | null;
  lane_spent: string | null;
  given: string | null;
  wrap_up_notified: boolean | null;
}

export type BudgetVerdict =
  | { kind: "ok" }
  | { kind: "wrap_up" }
  | { kind: "force"; reason: string }
  | { kind: "leader_note"; note: string };

export const LANE_SHARE_SPENT_REASON = "This lane has used its budget share";
export const SWARM_BUDGET_SPENT_REASON = "The swarm's token budget is used up";
export const SWARM_DEADLINE_REASON = "The swarm's time budget is up";

// Weighted tokens of each model response go to the swarm and to the lane that spent them, in one
// statement. There are no reservations.
export async function chargeSwarmStep(swarm: SwarmRunContext, taskId: string, weightedTokens: number | null): Promise<void> {
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

// Decides what a run must be told before its next request. The leader works from the reserve once the
// lanes' part is spent, and is only told to deliver when the whole budget (or the time) is gone.
// Check lanes are paid from the reserve too, so the lanes' part running out does not stop them.
export function judgeBudget(state: BudgetState, input: { isLane: boolean; isCheck: boolean; wrapUpPercent: number }): BudgetVerdict {
  const budget = state.token_budget === null ? null : Number(state.token_budget);
  const swarmSpent = Number(state.swarm_spent);
  if (!input.isLane) {
    if (budget !== null && swarmSpent >= budget) return { kind: "leader_note", note: LEADER_BUDGET_SPENT_NOTE };
    if (state.deadline_passed) return { kind: "leader_note", note: LEADER_DEADLINE_NOTE };
    return { kind: "ok" };
  }
  if (state.deadline_passed) return { kind: "force", reason: SWARM_DEADLINE_REASON };
  if (budget !== null) {
    const limit = input.isCheck ? budget : budget - Number(state.reserve_tokens);
    if (swarmSpent >= limit) return { kind: "force", reason: SWARM_BUDGET_SPENT_REASON };
  }
  if (state.share_tokens === null) return { kind: "ok" };
  const own = Number(state.share_tokens) - Number(state.given ?? 0);
  const spent = Number(state.lane_spent ?? 0);
  if (spent >= own) return { kind: "force", reason: LANE_SHARE_SPENT_REASON };
  if (!state.wrap_up_notified && spent >= own * input.wrapUpPercent / 100) return { kind: "wrap_up" };
  return { kind: "ok" };
}

async function loadBudgetState(swarm: SwarmRunContext, taskId: string): Promise<BudgetState | null> {
  const result = await query<BudgetState>(
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

// Runs before each request. A lane at its wrap-up fraction gets one note; at its share, the swarm
// budget or the deadline it is made to submit. The leader is told once per run to deliver. Notes go
// to the end of the conversation, like the step-limit notice, never into the prefix.
export async function applySwarmBudget(execution: AgentExecutionContext, swarm: SwarmRunContext | null): Promise<void> {
  if (!swarm?.settings.budgetsEnabled) return;
  if (swarm.forcedSubmitReason || swarm.budgetNoteSent) return;
  const state = await loadBudgetState(swarm, execution.job.taskId);
  if (!state) return;
  const lane = swarm.lane;
  const verdict = judgeBudget(state, {
    isLane: lane !== null,
    isCheck: lane?.kind === "check",
    wrapUpPercent: swarm.settings.advanced.laneWrapUpPercent
  });
  if (verdict.kind === "force") {
    swarm.forcedSubmitReason = verdict.reason;
  } else if (verdict.kind === "wrap_up" && lane) {
    await query("UPDATE task_swarm_lanes SET wrap_up_notified = true, updated_at = now() WHERE task_id = $1", [lane.task_id]);
    execution.state.dispatchState.conversationItems.push({ role: "user", content: buildLaneWrapUpNote(swarm.settings.advanced.laneWrapUpPercent) });
  } else if (verdict.kind === "leader_note") {
    swarm.budgetNoteSent = true;
    execution.state.dispatchState.conversationItems.push({ role: "user", content: verdict.note });
  }
}
