import { LEADER_BUDGET_SPENT_NOTE, LEADER_DEADLINE_NOTE } from "./prompt.js";

// Budget verdicts while a swarm runs. Only when budgets are on: otherwise a swarm is bounded by
// fan-out, depth, the running-lane cap and step limits. Spending and shares live on the server.

export interface SwarmBudgetState {
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

// Decides what a run must be told before its next request. The leader works from the reserve once the
// lanes' part is spent, and is only told to deliver when the whole budget (or the time) is gone.
// Check lanes are paid from the reserve too, so the lanes' part running out does not stop them.
export function judgeBudget(state: SwarmBudgetState, input: { isLane: boolean; isCheck: boolean; wrapUpPercent: number }): BudgetVerdict {
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
