import { buildTaskRunQueueJobId } from "@meowbert/shared";
import type { PoolClient } from "pg";
import { query, withTransaction } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import type { LoadedWorkflowRunContext } from "./context.js";
import { resolveManagedSwarmNode } from "./swarm-management-scope.js";
import { resolveSwarmTarget, type SwarmTarget } from "./swarm-target.js";
import { outstandingSwarmDependencies, parseSwarmPauses, type StoredSwarmPauseMap } from "./agent-swarm-dependencies.js";
import { removeSwarmPauses } from "./agent-swarm-mailbox.js";
import { grantSwarmWorkerLeaseInTx, prepareSwarmWorkerLeaseInTx } from "./agent-swarm-worker-lease.js";
import {
  asObject,
  enqueueWorkflowTaskRun,
  formatSwarmAgentLabel,
  getSwarmToolOptionsOverride,
  type WorkflowAgentRole
} from "./shared.js";

const REMOVABLE_PENDING_JOB_STATES = new Set(["waiting", "delayed", "paused", "prioritized", "waiting-children"]);

interface SwarmWorker {
  taskId: string;
  label: string;
  status: string;
  stopped: boolean;
  paused: boolean;
  pauseReason: string | null;
  waitingForTaskIds: string[];
}

interface SwarmAgentRow {
  task_id: string;
  role: "leader" | "worker";
  slot_index: number;
  title: string | null;
  status: string;
  cancellation_requested: boolean;
  has_live_run: boolean;
  workflow_state_json: Record<string, unknown> | null;
}

interface LabeledSwarmAgent {
  task_id: string;
  role: WorkflowAgentRole;
  slot_index: number;
  title: string | null;
}

function agentLabel(agent: Omit<LabeledSwarmAgent, "task_id">): string {
  return formatSwarmAgentLabel(agent.role, agent.slot_index, agent.title);
}

export function resolveWorkerIds(workers: LabeledSwarmAgent[], identifiers: string[]): string[] {
  const known = new Map<string, string>();
  for (const worker of workers) {
    known.set(worker.task_id.toLowerCase(), worker.task_id);
    known.set(agentLabel(worker).toLowerCase(), worker.task_id);
  }
  return Array.from(new Set(identifiers.map((identifier) => {
    const taskId = known.get(identifier.trim().toLowerCase());
    if (!taskId) throw new Error(`Unknown swarm worker: ${identifier}`);
    return taskId;
  })));
}

async function loadAgents(workflowTaskId: string): Promise<SwarmAgentRow[]> {
  const result = await query<SwarmAgentRow>(
    `SELECT a.task_id, a.role, a.slot_index, t.title, t.status, t.cancellation_requested,
            EXISTS (SELECT 1 FROM task_runs tr WHERE tr.task_id = t.id AND tr.ended_at IS NULL) AS has_live_run,
            w.state_json AS workflow_state_json
       FROM task_workflow_agents a
       JOIN tasks t ON t.id = a.task_id
       JOIN task_workflows w ON w.task_id = a.workflow_task_id
      WHERE a.workflow_task_id = $1
      ORDER BY a.slot_index ASC, a.task_id ASC`,
    [workflowTaskId]
  );
  return result.rows;
}

async function cancelPendingWorkerRuns(workerTaskIds: string[]): Promise<void> {
  if (workerTaskIds.length === 0) return;
  const runs = await query<{ run_id: string; task_id: string }>(
    `SELECT id AS run_id, task_id FROM task_runs
      WHERE task_id = ANY($1::uuid[]) AND ended_at IS NULL`,
    [workerTaskIds]
  );
  const cancelledRunIds: string[] = [];
  for (const run of runs.rows) {
    const job = await taskQueue.getJob(buildTaskRunQueueJobId(run.task_id, run.run_id));
    if (!job) {
      cancelledRunIds.push(run.run_id);
    } else if (REMOVABLE_PENDING_JOB_STATES.has(await job.getState())) {
      await job.remove().catch(() => undefined);
      cancelledRunIds.push(run.run_id);
    }
  }
  if (cancelledRunIds.length > 0) {
    await query(
      `UPDATE task_runs SET ended_at = now(), exit_reason = 'cancelled'
        WHERE id = ANY($1::uuid[]) AND ended_at IS NULL`,
      [cancelledRunIds]
    );
  }
}

function toAgent(worker: SwarmAgentRow, pauses: StoredSwarmPauseMap): SwarmWorker {
  const pause = pauses[worker.task_id];
  return {
    taskId: worker.task_id,
    label: agentLabel(worker),
    status: worker.status,
    stopped: worker.cancellation_requested,
    paused: Boolean(pause),
    pauseReason: pause?.status ?? null,
    waitingForTaskIds: pause ? outstandingSwarmDependencies(pause) : []
  };
}

async function updateStartedWorkerState(
  client: PoolClient,
  workflowTaskId: string,
  input: { startedTaskId?: string; stoppedTaskIds?: string[]; legacyWorkerTaskIds: string[] }
): Promise<string | null> {
  const workflowResult = await client.query<{ state_json: Record<string, unknown> | null }>(
    `SELECT state_json FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
    [workflowTaskId]
  );
  const currentState = asObject(workflowResult.rows[0]?.state_json);
  const startedIds = new Set(Array.isArray(currentState.startedSwarmWorkerTaskIds)
    ? currentState.startedSwarmWorkerTaskIds.filter((id): id is string => typeof id === "string")
    : currentState.workersStartedAt ? input.legacyWorkerTaskIds : []);
  for (const taskId of input.stoppedTaskIds ?? []) startedIds.delete(taskId);
  if (input.startedTaskId) startedIds.add(input.startedTaskId);
  const workersStartedAt = typeof currentState.workersStartedAt === "string"
    ? currentState.workersStartedAt
    : input.startedTaskId ? new Date().toISOString() : null;
  await client.query(
    `UPDATE task_workflows SET state_json = $2::jsonb, updated_at = now() WHERE task_id = $1`,
    [workflowTaskId, JSON.stringify({
      ...currentState,
      workersStartedAt,
      startedSwarmWorkerTaskIds: Array.from(startedIds)
    })]
  );
  return workersStartedAt;
}

export async function manageSwarmWorkers(input: {
  context: LoadedWorkflowRunContext;
  targetSwarm?: SwarmTarget;
  start: string[];
  stop: string[];
  grantBudget: Array<{ worker: string; tokens: number }>;
  viewOnly: boolean;
}): Promise<{
  started: string[];
  stopped: string[];
  granted: Array<{ label: string; tokens: number }>;
  workers: SwarmWorker[];
  agents: SwarmWorker[];
}> {
  const { context } = input;
  const target = resolveSwarmTarget(context, input.targetSwarm);
  const managedNode = resolveManagedSwarmNode(context, input.targetSwarm);
  if (!managedNode) {
    throw new Error("Only an Agent Swarm node leader can manage its workers.");
  }
  const allAgents = await loadAgents(context.workflowTaskId);
  const workers = allAgents.filter((agent) => managedNode.workerTaskIds.includes(agent.task_id));
  const startIds = resolveWorkerIds(workers, input.start);
  const stopIds = resolveWorkerIds(workers, input.stop);
  const grants = input.grantBudget.map((grant) => ({ taskId: resolveWorkerIds(workers, [grant.worker])[0], tokens: grant.tokens }));
  const stoppedGrant = grants.find((grant) => stopIds.includes(grant.taskId));
  if (stoppedGrant) throw new Error("A worker cannot be granted budget and stopped in the same call.");
  if (grants.length > 0 && !target.nodeId) throw new Error("Worker budget grants require a budgeted Swarm.");
  const snapshot = (agents: SwarmAgentRow[]) => {
    const state = asObject(agents[0]?.workflow_state_json);
    const pauses = parseSwarmPauses(state);
    return {
      workers: agents.filter((agent) => managedNode.workerTaskIds.includes(agent.task_id)).map((agent) => toAgent(agent, pauses)),
      agents: agents.map((agent) => toAgent(agent, pauses))
    };
  };
  if (input.viewOnly) return { started: [], stopped: [], granted: [], ...snapshot(allAgents) };
  const startTaskIds = workers
    .filter((worker) => startIds.includes(worker.task_id) && !worker.has_live_run)
    .map((worker) => worker.task_id);
  const legacyWorkerTaskIds = context.agents.filter((agent) => agent.role === "worker").map((agent) => agent.task_id);

  await withTransaction(async (client) => {
    for (const grant of grants) {
      await grantSwarmWorkerLeaseInTx(client, {
        workflowTaskId: context.workflowTaskId,
        nodeKey: target.nodeId!,
        workerTaskId: grant.taskId,
        tokens: grant.tokens
      });
    }
    if (stopIds.length > 0) {
      await client.query(
        `UPDATE tasks SET cancellation_requested = true, resume_after_interrupt = false, updated_at = now()
          WHERE id = ANY($1::uuid[])`,
        [stopIds]
      );
      await removeSwarmPauses(client, context.workflowTaskId, stopIds);
      await updateStartedWorkerState(client, context.workflowTaskId, { stoppedTaskIds: stopIds, legacyWorkerTaskIds });
    }
    if (startTaskIds.length > 0) {
      if (target.nodeId) {
        for (const taskId of startTaskIds) {
          await prepareSwarmWorkerLeaseInTx(client, {
            workflowTaskId: context.workflowTaskId,
            nodeKey: target.nodeId,
            workerTaskId: taskId
          });
        }
      }
      if (target.nodeId) {
        const workflowResult = await client.query<{ state_json: Record<string, unknown> | null }>(
          `SELECT state_json FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
          [context.workflowTaskId]
        );
        const state = asObject(workflowResult.rows[0]?.state_json);
        const completedSwarmNodeIds = asObject(state.completedSwarmNodeIds);
        if (completedSwarmNodeIds[target.nodeId]) {
          delete completedSwarmNodeIds[target.nodeId];
          await client.query(
            `UPDATE task_workflows SET state_json = $2::jsonb, updated_at = now() WHERE task_id = $1`,
            [context.workflowTaskId, JSON.stringify({ ...state, completedSwarmNodeIds })]
          );
        }
      }
      await client.query(
        `UPDATE tasks SET cancellation_requested = false, resume_after_interrupt = false, completed_at = NULL, updated_at = now()
          WHERE id = ANY($1::uuid[])`,
        [startTaskIds]
      );
      await removeSwarmPauses(client, context.workflowTaskId, startTaskIds);
    }
  });

  await cancelPendingWorkerRuns(stopIds);
  for (const taskId of startTaskIds) {
    await enqueueWorkflowTaskRun({
      taskId,
      workspaceId: context.workspaceId,
      environmentId: context.environmentId,
      triggerSource: "web",
      mode: "agent_swarm_worker",
      toolOptionsOverride: getSwarmToolOptionsOverride(context)
    });
    const workersStartedAt = await withTransaction((client) => updateStartedWorkerState(
      client, context.workflowTaskId, { startedTaskId: taskId, legacyWorkerTaskIds }
    ));
    if (context.swarm) context.swarm.workersStartedAt = workersStartedAt;
  }
  const currentAgents = await loadAgents(context.workflowTaskId);
  const currentWorkers = currentAgents.filter((agent) => managedNode.workerTaskIds.includes(agent.task_id));
  return {
    started: currentWorkers.filter((worker) => startTaskIds.includes(worker.task_id)).map(agentLabel),
    stopped: currentWorkers.filter((worker) => stopIds.includes(worker.task_id)).map(agentLabel),
    granted: grants.map((grant) => ({
      label: agentLabel(currentWorkers.find((worker) => worker.task_id === grant.taskId) ?? workers.find((worker) => worker.task_id === grant.taskId)!),
      tokens: grant.tokens
    })),
    ...snapshot(currentAgents)
  };
}
