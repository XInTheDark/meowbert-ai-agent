import type { PoolClient } from "pg";
import { AGENT_SWARM_MINIMUM_LANE_STEPS, AGENT_SWARM_MINIMUM_STEP_TOKENS } from "@meowbert/shared";
import type { SwarmRunContext } from "./config.js";
import { SwarmToolError } from "./tool-error.js";

// With budgets on, the leader and all lanes share one token budget. A share of it is held back on
// the swarm row (reserve_tokens) for merge, assembly and Check; the rest is divided across lanes when
// they are forked. Budget never moves between running lanes: a parent gives it out at a split, or at
// a resume. With budgets off nothing here runs.

export const MINIMUM_LANE_SHARE_TOKENS = AGENT_SWARM_MINIMUM_STEP_TOKENS * AGENT_SWARM_MINIMUM_LANE_STEPS;

// Divides what the parent can give across new lanes by weight. Each lane must get enough for a few
// steps, which is the guard against splitting into many pointless lanes.
export function allocateLaneShares(available: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const shares = weights.map((weight) => Math.floor(Math.max(0, available) * weight / totalWeight));
  if (shares.some((share) => share < MINIMUM_LANE_SHARE_TOKENS)) {
    throw new SwarmToolError(
      `The budget left (${Math.max(0, Math.floor(available)).toLocaleString("en-US")} tokens) is not enough for ${weights.length} lane${weights.length === 1 ? "" : "s"}. Use fewer lanes, give them more equal weights, or do the work yourself.`
    );
  }
  return shares;
}

// What a parent has left to give: for the leader, the swarm's budget minus the reserve, what was spent
// and what running lanes still hold; for a lane, its own share minus what it spent and gave its lanes.
// A lane that splits keeps the reserve fraction of what it has for its own merge.
export async function loadGivableTokensInTx(client: PoolClient, swarm: SwarmRunContext, parentTaskId: string): Promise<number> {
  if (swarm.lane) {
    const result = await client.query<{ share_tokens: string | null; spent_tokens: string; given: string }>(
      `SELECT lane.share_tokens, lane.spent_tokens,
              (SELECT COALESCE(SUM(child.share_tokens), 0) FROM task_swarm_lanes child WHERE child.parent_task_id = lane.task_id)::text AS given
         FROM task_swarm_lanes lane WHERE lane.task_id = $1`,
      [parentTaskId]
    );
    const row = result.rows[0];
    if (!row || row.share_tokens === null) return 0;
    const left = Number(row.share_tokens) - Number(row.spent_tokens) - Number(row.given);
    return left * (1 - swarm.settings.advanced.budgetReservePercent / 100);
  }
  const result = await client.query<{ token_budget: string | null; reserve_tokens: string; spent_tokens: string; held: string }>(
    `SELECT swarm.token_budget, swarm.reserve_tokens, swarm.spent_tokens,
            (SELECT COALESCE(SUM(GREATEST(lane.share_tokens - lane.spent_tokens, 0)), 0)
               FROM task_swarm_lanes lane
              WHERE lane.parent_task_id = swarm.task_id AND lane.status IN ('queued', 'running', 'waiting'))::text AS held
       FROM task_swarms swarm WHERE swarm.task_id = $1`,
    [swarm.swarmTaskId]
  );
  const row = result.rows[0];
  if (!row || row.token_budget === null) return 0;
  return Number(row.token_budget) - Number(row.reserve_tokens) - Number(row.spent_tokens) - Number(row.held);
}

// Shares for the lanes of one split or diverge, or nulls when budgets are off. Caller holds the swarm lock.
export async function allocateForkSharesInTx(
  client: PoolClient,
  swarm: SwarmRunContext,
  parentTaskId: string,
  weights: number[]
): Promise<Array<number | null>> {
  if (!swarm.settings.budgetsEnabled) return weights.map(() => null);
  return allocateLaneShares(await loadGivableTokensInTx(client, swarm, parentTaskId), weights);
}

// Reclaim a dormant lane's unused share before reactivating it, plus any requested extra tokens.
// Nested parents already hold all their children's shares; the leader releases dormant shares.
export async function addResumeShareInTx(
  client: PoolClient,
  swarm: SwarmRunContext,
  parentTaskId: string,
  laneTaskId: string,
  extraTokens: number | null
): Promise<void> {
  if (!swarm.settings.budgetsEnabled) return;
  const givable = await loadGivableTokensInTx(client, swarm, parentTaskId);
  const lane = await client.query<{ unused: string }>(
    "SELECT GREATEST(share_tokens - spent_tokens, 0)::text AS unused FROM task_swarm_lanes WHERE task_id = $1",
    [laneTaskId]
  );
  const restored = swarm.lane ? 0 : Number(lane.rows[0]?.unused ?? 0);
  if (restored + (extraTokens ?? 0) > givable) {
    throw new SwarmToolError(`You have ${Math.max(0, Math.floor(givable)).toLocaleString("en-US")} tokens left to give.`);
  }
  await client.query(
    "UPDATE task_swarm_lanes SET share_tokens = COALESCE(share_tokens, 0) + $2, wrap_up_notified = false, updated_at = now() WHERE task_id = $1",
    [laneTaskId, extraTokens ?? 0]
  );
}
