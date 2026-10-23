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
    // clock_timestamp keeps the lanes of one split in the order they were given, for FIFO starts. A
    // fork already knows everything before it, so its note cursor starts after the swarm's latest note.
    `INSERT INTO task_swarm_lanes (task_id, swarm_task_id, parent_task_id, depth, kind, title, direction, status, fork_seed_id, weight,
       note_cursor, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'queued', $8, $9,
       (SELECT COALESCE(MAX(seq), 0) FROM task_swarm_notes WHERE swarm_task_id = $2), clock_timestamp())`,
    [lane.taskId, lane.swarmTaskId, lane.parentTaskId, lane.depth, lane.kind, lane.title, lane.direction, lane.forkSeedId, lane.weight]
  );
}

export async function setLaneStatusInTx(client: PoolClient, laneTaskId: string, status: SwarmLaneStatus, input: {
  result?: SwarmLaneResult;
} = {}): Promise<SwarmLaneRow | null> {
  const terminal = (TERMINAL_LANE_STATUSES as readonly string[]).includes(status);
  const result = await client.query<SwarmLaneRow>(
    `UPDATE task_swarm_lanes
        SET status = $2,
            result_json = COALESCE($3::jsonb, result_json),
            started_at = CASE WHEN $2 = 'running' THEN COALESCE(started_at, now()) ELSE started_at END,
            ended_at = CASE WHEN $4 THEN now() ELSE NULL END,
            merged_at = CASE WHEN $4 THEN NULL ELSE merged_at END,
            updated_at = now()
      WHERE task_id = $1
      RETURNING ${LANE_COLUMNS}`,
    [laneTaskId, status, input.result ? JSON.stringify(input.result) : null, terminal]
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

// Lanes from the lane's parent up to the leader's direct child; depth is at most three.
export async function listAncestorLanes(
  client: SwarmQueryable,
  lane: Pick<SwarmLaneRow, "parent_task_id">
): Promise<Array<Pick<SwarmLaneRow, "task_id" | "kind">>> {
  const result = await client.query<Pick<SwarmLaneRow, "task_id" | "kind">>(
    `WITH RECURSIVE ancestors AS (
       SELECT task_id, parent_task_id, kind, 1 AS level FROM task_swarm_lanes WHERE task_id = $1
       UNION ALL
       SELECT lane.task_id, lane.parent_task_id, lane.kind, ancestors.level + 1
         FROM task_swarm_lanes lane JOIN ancestors ON lane.task_id = ancestors.parent_task_id
        WHERE ancestors.level < 4
     )
     SELECT task_id, kind FROM ancestors ORDER BY level`,
    [lane.parent_task_id]
  );
  return result.rows;
}

// Every lane below this task, nearest first; stopping a lane stops these too.
export async function listDescendantLaneIdsInTx(client: SwarmQueryable, taskId: string): Promise<string[]> {
  const result = await client.query<{ task_id: string }>(
    `WITH RECURSIVE descendants AS (
       SELECT task_id, 1 AS level FROM task_swarm_lanes WHERE parent_task_id = $1
       UNION ALL
       SELECT lane.task_id, descendants.level + 1
         FROM task_swarm_lanes lane JOIN descendants ON lane.parent_task_id = descendants.task_id
        WHERE descendants.level < 4
     )
     SELECT task_id FROM descendants ORDER BY level`,
    [taskId]
  );
  return result.rows.map((row) => row.task_id);
}

// A lane a parent may act on: its own direct child.
export async function loadChildLane(client: SwarmQueryable, parentTaskId: string, laneTaskId: string): Promise<SwarmLaneRow | null> {
  const lane = await loadLane(client, laneTaskId);
  return lane && lane.parent_task_id === parentTaskId ? lane : null;
}

// A lane that split or diverged at some point; only those (and the leader) can start a Check.
export async function hasOwnLanes(client: SwarmQueryable, taskId: string): Promise<boolean> {
  const result = await client.query("SELECT 1 FROM task_swarm_lanes WHERE parent_task_id = $1 AND kind <> 'check' LIMIT 1", [taskId]);
  return (result.rowCount ?? 0) > 0;
}

// A discarded lane's result is dropped. When its parent is running it already knows (it asked for the
// stop), so nothing is delivered; a parked parent still hears that the lane was discarded.
export async function dropDiscardedResultInTx(client: SwarmQueryable, lane: Pick<SwarmLaneRow, "task_id" | "parent_task_id">): Promise<void> {
  await client.query(
    `UPDATE task_swarm_lanes SET merged_at = now(), updated_at = now()
      WHERE task_id = $1
        AND EXISTS (SELECT 1 FROM task_runs WHERE task_id = $2 AND ended_at IS NULL)`,
    [lane.task_id, lane.parent_task_id]
  );
}
