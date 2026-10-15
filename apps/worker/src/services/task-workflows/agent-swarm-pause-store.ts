import type { PoolClient } from "pg";
import type { TaskExecutionJob } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import type { StoredSwarmPause, StoredSwarmPauseMap } from "./agent-swarm-dependencies.js";

// Pauses and the stall marker live in their own rows. Decisions that read several pauses at once
// (wakes, waits, stall detection) still run one at a time per swarm: callers lock the workflow row
// with lockSwarmWorkflowInTx first, which also tells them whether the swarm has completed.

interface SwarmPauseRow {
  task_id: string;
  swarm_node_id: string | null;
  since_message_no: string | number;
  status: string;
  waiting_for_task_ids: string[];
  finished_task_ids: string[];
  trigger_source: string;
  selection_user_id: string | null;
  mode: StoredSwarmPause["mode"];
}

export interface SwarmStallMarker {
  nudgedTaskId: string;
  escalated: boolean;
}

const PAUSE_COLUMNS = `task_id, swarm_node_id, since_message_no, status, waiting_for_task_ids,
  finished_task_ids, trigger_source, selection_user_id, mode`;

function toStoredSwarmPause(row: SwarmPauseRow): StoredSwarmPause {
  return {
    swarmNodeId: row.swarm_node_id,
    sinceMessageNo: Number(row.since_message_no) || 0,
    status: row.status,
    waitingForTaskIds: row.waiting_for_task_ids ?? [],
    finishedTaskIds: row.finished_task_ids ?? [],
    triggerSource: row.trigger_source as TaskExecutionJob["triggerSource"],
    selectionUserId: row.selection_user_id,
    mode: row.mode
  };
}

function toPauseMap(rows: SwarmPauseRow[]): StoredSwarmPauseMap {
  return Object.fromEntries(rows.map((row) => [row.task_id, toStoredSwarmPause(row)]));
}

export async function lockSwarmWorkflowInTx(client: PoolClient, workflowTaskId: string): Promise<{ completed: boolean }> {
  const result = await client.query<{ phase: string | null }>(
    `SELECT phase FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
    [workflowTaskId]
  );
  return { completed: result.rows[0]?.phase === "completed" };
}

export async function loadSwarmPausesInTx(client: PoolClient, workflowTaskId: string): Promise<StoredSwarmPauseMap> {
  const result = await client.query<SwarmPauseRow>(
    `SELECT ${PAUSE_COLUMNS} FROM task_workflow_swarm_pauses WHERE workflow_task_id = $1`,
    [workflowTaskId]
  );
  return toPauseMap(result.rows);
}

export async function loadSwarmPauses(workflowTaskId: string): Promise<StoredSwarmPauseMap> {
  const result = await query<SwarmPauseRow>(
    `SELECT ${PAUSE_COLUMNS} FROM task_workflow_swarm_pauses WHERE workflow_task_id = $1`,
    [workflowTaskId]
  );
  return toPauseMap(result.rows);
}

export async function saveSwarmPauseInTx(
  client: PoolClient,
  workflowTaskId: string,
  taskId: string,
  pause: StoredSwarmPause
): Promise<void> {
  await client.query(
    `INSERT INTO task_workflow_swarm_pauses (
       workflow_task_id, task_id, swarm_node_id, since_message_no, status,
       waiting_for_task_ids, finished_task_ids, trigger_source, selection_user_id, mode
     ) VALUES ($1, $2, $3, $4, $5, $6::uuid[], $7::uuid[], $8, $9, $10)
     ON CONFLICT (workflow_task_id, task_id) DO UPDATE
       SET swarm_node_id = EXCLUDED.swarm_node_id,
           since_message_no = EXCLUDED.since_message_no,
           status = EXCLUDED.status,
           waiting_for_task_ids = EXCLUDED.waiting_for_task_ids,
           finished_task_ids = EXCLUDED.finished_task_ids,
           trigger_source = EXCLUDED.trigger_source,
           selection_user_id = EXCLUDED.selection_user_id,
           mode = EXCLUDED.mode,
           created_at = now()`,
    [
      workflowTaskId, taskId, pause.swarmNodeId, pause.sinceMessageNo, pause.status,
      pause.waitingForTaskIds, pause.finishedTaskIds, pause.triggerSource, pause.selectionUserId, pause.mode
    ]
  );
}

export async function deleteSwarmPausesInTx(client: PoolClient, workflowTaskId: string, taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;
  await client.query(
    `DELETE FROM task_workflow_swarm_pauses WHERE workflow_task_id = $1 AND task_id = ANY($2::uuid[])`,
    [workflowTaskId, taskIds]
  );
}

export async function takeSwarmPauseInTx(
  client: PoolClient,
  workflowTaskId: string,
  taskId: string
): Promise<StoredSwarmPause | null> {
  const result = await client.query<SwarmPauseRow>(
    `DELETE FROM task_workflow_swarm_pauses WHERE workflow_task_id = $1 AND task_id = $2
     RETURNING ${PAUSE_COLUMNS}`,
    [workflowTaskId, taskId]
  );
  return result.rows[0] ? toStoredSwarmPause(result.rows[0]) : null;
}

export async function saveFinishedSwarmDependenciesInTx(
  client: PoolClient,
  workflowTaskId: string,
  updates: Array<{ taskId: string; finishedTaskIds: string[] }>
): Promise<void> {
  for (const update of updates) {
    await client.query(
      `UPDATE task_workflow_swarm_pauses SET finished_task_ids = $3::uuid[]
        WHERE workflow_task_id = $1 AND task_id = $2`,
      [workflowTaskId, update.taskId, update.finishedTaskIds]
    );
  }
}

export async function loadSwarmStallInTx(client: PoolClient, workflowTaskId: string): Promise<SwarmStallMarker | null> {
  const result = await client.query<{ nudged_task_id: string; escalated: boolean }>(
    `SELECT nudged_task_id, escalated FROM task_workflow_swarm_stalls WHERE workflow_task_id = $1`,
    [workflowTaskId]
  );
  const row = result.rows[0];
  return row ? { nudgedTaskId: row.nudged_task_id, escalated: row.escalated } : null;
}

export async function saveSwarmStallInTx(client: PoolClient, workflowTaskId: string, stall: SwarmStallMarker): Promise<void> {
  await client.query(
    `INSERT INTO task_workflow_swarm_stalls (workflow_task_id, nudged_task_id, escalated)
     VALUES ($1, $2, $3)
     ON CONFLICT (workflow_task_id) DO UPDATE
       SET nudged_task_id = EXCLUDED.nudged_task_id, escalated = EXCLUDED.escalated, updated_at = now()`,
    [workflowTaskId, stall.nudgedTaskId, stall.escalated]
  );
}

// A run by any agent other than the one just nudged is progress, so the next stall gets a fresh nudge.
export async function clearSwarmStallAfterProgressInTx(
  client: PoolClient,
  workflowTaskId: string,
  startedTaskId: string
): Promise<void> {
  await client.query(
    `DELETE FROM task_workflow_swarm_stalls WHERE workflow_task_id = $1 AND nudged_task_id <> $2`,
    [workflowTaskId, startedTaskId]
  );
}
