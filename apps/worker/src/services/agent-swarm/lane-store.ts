import type { PoolClient } from "pg";

export type SwarmQueryable = Pick<PoolClient, "query">;

export type SwarmLaneKind = "split" | "diverge" | "check";
export type SwarmLaneStatus = "queued" | "running" | "waiting" | "done" | "failed" | "stopped" | "expired";

// A lane that has not finished: its parent's barrier waits for it.
export const ACTIVE_LANE_STATUSES: readonly SwarmLaneStatus[] = ["queued", "running", "waiting"];
export const TERMINAL_LANE_STATUSES: readonly SwarmLaneStatus[] = ["done", "failed", "stopped"];

export interface SwarmLaneFile {
  path: string;
  bytes: number | null;
}

export interface SwarmLaneResult {
  summary: string;
  decisions: Array<{ choice: string; reason: string; would_change_if: string }> | null;
  findings: Array<{ severity: string; location: string; issue: string }> | null;
  files: SwarmLaneFile[];
}

export interface SwarmLaneRow {
  task_id: string;
  swarm_task_id: string;
  parent_task_id: string;
  depth: number;
  kind: SwarmLaneKind;
  title: string;
  direction: string | null;
  status: SwarmLaneStatus;
  fork_seed_id: string | null;
  weight: string;
  share_tokens: string | null;
  spent_tokens: string;
  steps: number;
  note_cursor: string;
  result_json: SwarmLaneResult | null;
  merged_at: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

const LANE_COLUMNS = `task_id, swarm_task_id, parent_task_id, depth, kind, title, direction, status, fork_seed_id,
  weight, share_tokens, spent_tokens, steps, note_cursor, result_json, merged_at, created_at, started_at, ended_at`;

export async function loadLane(client: SwarmQueryable, laneTaskId: string, options: { forUpdate?: boolean } = {}): Promise<SwarmLaneRow | null> {
  const result = await client.query<SwarmLaneRow>(
    `SELECT ${LANE_COLUMNS} FROM task_swarm_lanes WHERE task_id = $1${options.forUpdate ? " FOR UPDATE" : ""}`,
    [laneTaskId]
  );
  return result.rows[0] ?? null;
}

export async function insertLaneInTx(client: PoolClient, lane: {
  taskId: string;
  swarmTaskId: string;
  parentTaskId: string;
  depth: number;
  kind: SwarmLaneKind;
  title: string;
  direction: string | null;
  forkSeedId: string | null;
  weight: number;
}): Promise<void> {
  await client.query(
    // clock_timestamp keeps the lanes of one split in the order they were given, for FIFO starts.
    `INSERT INTO task_swarm_lanes (task_id, swarm_task_id, parent_task_id, depth, kind, title, direction, status, fork_seed_id, weight, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9, clock_timestamp())`,
    [lane.taskId, lane.swarmTaskId, lane.parentTaskId, lane.depth, lane.kind, lane.title, lane.direction, lane.forkSeedId, lane.weight]
  );
}

export async function setLaneStatusInTx(client: PoolClient, laneTaskId: string, status: SwarmLaneStatus, input: {
  result?: SwarmLaneResult;
  addSteps?: number;
} = {}): Promise<SwarmLaneRow | null> {
  const terminal = (TERMINAL_LANE_STATUSES as readonly string[]).includes(status);
  const result = await client.query<SwarmLaneRow>(
    `UPDATE task_swarm_lanes
        SET status = $2,
            result_json = COALESCE($3::jsonb, result_json),
            steps = steps + $4,
            started_at = CASE WHEN $2 = 'running' THEN COALESCE(started_at, now()) ELSE started_at END,
            ended_at = CASE WHEN $5 THEN now() ELSE NULL END,
            merged_at = CASE WHEN $5 THEN NULL ELSE merged_at END,
            updated_at = now()
      WHERE task_id = $1
      RETURNING ${LANE_COLUMNS}`,
    [laneTaskId, status, input.result ? JSON.stringify(input.result) : null, input.addSteps ?? 0, terminal]
  );
  return result.rows[0] ?? null;
}

export async function countActiveChildrenInTx(client: SwarmQueryable, parentTaskId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM task_swarm_lanes WHERE parent_task_id = $1 AND status = ANY($2::text[])",
    [parentTaskId, ACTIVE_LANE_STATUSES]
  );
  return Number(result.rows[0]?.count ?? 0);
}

// Lane ids from the lane's parent up to the leader's direct child; depth is at most three.
export async function listAncestorLaneIds(client: SwarmQueryable, lane: Pick<SwarmLaneRow, "parent_task_id">): Promise<string[]> {
  const result = await client.query<{ task_id: string }>(
    `WITH RECURSIVE ancestors AS (
       SELECT task_id, parent_task_id, 1 AS level FROM task_swarm_lanes WHERE task_id = $1
       UNION ALL
       SELECT lane.task_id, lane.parent_task_id, ancestors.level + 1
         FROM task_swarm_lanes lane JOIN ancestors ON lane.task_id = ancestors.parent_task_id
        WHERE ancestors.level < 4
     )
     SELECT task_id FROM ancestors ORDER BY level`,
    [lane.parent_task_id]
  );
  return result.rows.map((row) => row.task_id);
}
