import type { AgentSwarmOutcomeRow } from "@meowbert/shared";
import { query } from "../../lib/db.js";

const MAX_OUTCOME_ROWS = 50;

interface OutcomeQueryRow {
  leader_model: string;
  swarm_turns: number;
  lanes: number;
  split_lanes: number;
  diverge_lanes: number;
  check_lanes: number;
  stopped_lanes: number;
  failed_lanes: number;
  check_findings: number;
}

function ratio(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 1000) / 1000 : 0;
}

// How leaders on each model use lanes, from the outcome fields kept on every lane. A swarm's leader
// model is the model its first lanes were forked on; a swarm turn is a user message that lanes
// followed.
export async function loadAgentSwarmOutcomes(): Promise<AgentSwarmOutcomeRow[]> {
  const result = await query<OutcomeQueryRow>(
    `WITH leader_models AS (
       SELECT DISTINCT ON (seed.swarm_task_id) seed.swarm_task_id, seed.capabilities_json -> 'runtime' ->> 'model' AS model
         FROM task_swarm_fork_seeds seed
        WHERE seed.source_task_id = seed.swarm_task_id
        ORDER BY seed.swarm_task_id, seed.created_at
     ),
     lanes AS (
       SELECT lane.kind, lane.status, lane.check_findings, lane.swarm_task_id, leader.model AS leader_model,
              (SELECT message.id FROM task_messages message
                WHERE message.task_id = lane.swarm_task_id AND message.role = 'user' AND message.created_at <= lane.created_at
                ORDER BY message.created_at DESC LIMIT 1) AS turn_id
         FROM task_swarm_lanes lane
         JOIN leader_models leader ON leader.swarm_task_id = lane.swarm_task_id
     )
     SELECT COALESCE(leader_model, 'unknown') AS leader_model,
            COUNT(DISTINCT (swarm_task_id, turn_id))::int AS swarm_turns,
            COUNT(*)::int AS lanes,
            COUNT(*) FILTER (WHERE kind = 'split')::int AS split_lanes,
            COUNT(*) FILTER (WHERE kind = 'diverge')::int AS diverge_lanes,
            COUNT(*) FILTER (WHERE kind = 'check')::int AS check_lanes,
            COUNT(*) FILTER (WHERE status = 'stopped')::int AS stopped_lanes,
            COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_lanes,
            COALESCE(SUM(check_findings), 0)::int AS check_findings
       FROM lanes
      GROUP BY 1
      ORDER BY lanes DESC
      LIMIT $1`,
    [MAX_OUTCOME_ROWS]
  );
  return result.rows.map((row) => ({
    leaderModel: row.leader_model,
    swarmTurns: row.swarm_turns,
    lanes: row.lanes,
    lanesPerTurn: ratio(row.lanes - row.check_lanes, row.swarm_turns),
    splitLanes: row.split_lanes,
    divergeLanes: row.diverge_lanes,
    checkLanes: row.check_lanes,
    stoppedRate: ratio(row.stopped_lanes, row.lanes),
    failedRate: ratio(row.failed_lanes, row.lanes),
    checkFindingsPerTurn: ratio(row.check_findings, row.swarm_turns)
  }));
}
