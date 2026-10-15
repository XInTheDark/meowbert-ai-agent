import type { PoolClient } from "pg";
import type { TaskExecutionJob } from "@meowbert/shared";
import { withTransaction } from "../../lib/db.js";
import type { LoadedWorkflowRunContext } from "./context-types.js";
import { hasDualSwarmRole, resolveDirectWorkerTaskIds, resolveSwarmTarget, type SwarmTarget } from "./swarm-target.js";
import { outstandingSwarmDependencies, type StoredSwarmPauseMap } from "./agent-swarm-dependencies.js";
import {
  clearSwarmStallAfterProgressInTx,
  deleteSwarmPausesInTx,
  loadSwarmPausesInTx,
  lockSwarmWorkflowInTx,
  saveFinishedSwarmDependenciesInTx,
  saveSwarmPauseInTx,
  takeSwarmPauseInTx
} from "./agent-swarm-pause-store.js";
import {
  emitSwarmActivityEvent,
  enqueueSwarmWakes,
  type SwarmWake
} from "./agent-swarm-pause-state.js";
import { maybeResumeStalledSwarm } from "./agent-swarm-stall.js";
import { asObject, coerceNullableString, formatSwarmAgentLabel } from "./shared.js";

interface SwarmNodeChannel {
  leaderTaskId: string;
  workerTaskIds: string[];
}

function resolveSwarmNodeChannel(
  context: LoadedWorkflowRunContext,
  channelId: string
): SwarmNodeChannel | null {
  const compiledSwarm = asObject(context.config.compiledSwarm);
  const channelIds = asObject(context.config.swarmChannelIds);
  const nodeId = Object.entries(channelIds).find(([, value]) => value === channelId)?.[0] ?? null;
  const nodes = Array.isArray(compiledSwarm.nodes) ? compiledSwarm.nodes.map(asObject) : [];
  const node = nodeId ? nodes.find((candidate) => candidate.id === nodeId) ?? null : null;

  if (node) {
    const leafTaskIds = new Map(context.agents.flatMap((agent) => {
      const leafId = coerceNullableString(agent.state_json.swarmLeafId);
      return leafId ? [[leafId, agent.task_id] as const] : [];
    }));
    const leaderTaskId = typeof node.leaderLeafId === "string" ? leafTaskIds.get(node.leaderLeafId) : null;
    const workerTaskIds = Array.isArray(node.workerLeafIds)
      ? node.workerLeafIds
        .map((leafId) => typeof leafId === "string" ? leafTaskIds.get(leafId) : null)
        .filter((taskId): taskId is string => Boolean(taskId))
      : [];
    return leaderTaskId ? { leaderTaskId, workerTaskIds } : null;
  }

  if (context.swarm?.globalChannelId !== channelId) {
    return null;
  }

  const leaderTaskId = context.agents.find((agent) => agent.role === "leader")?.task_id ?? null;
  return leaderTaskId
    ? {
        leaderTaskId,
        workerTaskIds: context.agents.filter((agent) => agent.role === "worker").map((agent) => agent.task_id)
      }
    : null;
}

function agentLabel(context: LoadedWorkflowRunContext, taskId: string): string {
  const agent = context.agents.find((candidate) => candidate.task_id === taskId);
  return agent ? formatSwarmAgentLabel(agent.role, agent.slot_index, agent.title) : taskId;
}

// The agent has finished its current work: count it for agents waiting on it, and wake a leader
// waiting on no one in particular when one of its own workers finishes. Woken agents leave `pauses`;
// `progressed` lists the ones still waiting whose finished list grew.
function collectWakesForFinishedAgent(
  context: LoadedWorkflowRunContext,
  pauses: StoredSwarmPauseMap,
  finishedTaskId: string
): { wakes: SwarmWake[]; progressed: Array<{ taskId: string; finishedTaskIds: string[] }> } {
  const wakes: SwarmWake[] = [];
  const progressed: Array<{ taskId: string; finishedTaskIds: string[] }> = [];
  for (const [taskId, pause] of Object.entries(pauses)) {
    if (taskId === finishedTaskId) continue;
    let shouldWake = false;
    if (pause.waitingForTaskIds.length > 0) {
      if (!pause.waitingForTaskIds.includes(finishedTaskId)) continue;
      if (!pause.finishedTaskIds.includes(finishedTaskId)) pause.finishedTaskIds.push(finishedTaskId);
      shouldWake = outstandingSwarmDependencies(pause).length === 0;
      if (!shouldWake) progressed.push({ taskId, finishedTaskIds: pause.finishedTaskIds });
    } else {
      shouldWake = resolveDirectWorkerTaskIds(context, taskId).includes(finishedTaskId);
    }
    if (!shouldWake) continue;
    wakes.push({ taskId, ...pause });
    delete pauses[taskId];
  }
  return { wakes, progressed };
}

async function saveFinishedAgentWakesInTx(
  client: PoolClient,
  workflowTaskId: string,
  finished: ReturnType<typeof collectWakesForFinishedAgent>
): Promise<void> {
  await deleteSwarmPausesInTx(client, workflowTaskId, finished.wakes.map((wake) => wake.taskId));
  await saveFinishedSwarmDependenciesInTx(client, workflowTaskId, finished.progressed);
}

// Waiting on an agent that is paused or idle would stall the swarm, so only running agents, or ones
// this same pause is about to wake, can be waited on.
async function assertWaitTargetsRunning(
  client: PoolClient,
  context: LoadedWorkflowRunContext,
  input: { waitingForTaskIds: string[]; pauses: StoredSwarmPauseMap; wakingTaskIds: Set<string> }
): Promise<void> {
  const candidates = input.waitingForTaskIds.filter((taskId) => !input.wakingTaskIds.has(taskId));
  if (candidates.length === 0) return;
  const running = await client.query<{ id: string }>(
    `SELECT t.id
       FROM tasks t
      WHERE t.id = ANY($1::uuid[])
        AND t.cancellation_requested = false
        AND EXISTS (SELECT 1 FROM task_runs tr WHERE tr.task_id = t.id AND tr.ended_at IS NULL)`,
    [candidates]
  );
  const runningIds = new Set(running.rows.map((row) => row.id));
  const idle = candidates.filter((taskId) => input.pauses[taskId] || !runningIds.has(taskId));
  if (idle.length === 0) return;
  const labels = idle.map((taskId) => agentLabel(context, taskId)).join(", ");
  const directWorkers = resolveDirectWorkerTaskIds(context, context.taskId);
  const resumeHint = idle.every((taskId) => directWorkers.includes(taskId))
    ? "Assign it work with assign_worker, or message it directly"
    : "Message it directly";
  throw new Error(`${labels} ${idle.length === 1 ? "is" : "are"} not running, so waiting would stall the swarm. ${resumeHint}, then pause.`);
}

async function persistSwarmPause(
  client: PoolClient,
  input: {
    context: LoadedWorkflowRunContext;
    triggerSource: TaskExecutionJob["triggerSource"];
    selectionUserId: string | null;
    status: string;
    targetSwarm?: SwarmTarget;
    waitingForTaskIds?: string[] | null;
  }
): Promise<SwarmWake[]> {
  const { context } = input;
  const target = resolveSwarmTarget(context, input.targetSwarm);
  const dualRole = hasDualSwarmRole(context);
  const rosterIds = new Set(dualRole ? target.memberTaskIds : context.agents.map((agent) => agent.task_id));
  const waitingForTaskIds = Array.from(new Set(input.waitingForTaskIds ?? []));
  for (const taskId of waitingForTaskIds) {
    if (!rosterIds.has(taskId)) throw new Error(`Unknown swarm wait dependency: ${taskId}`);
    if (taskId === context.taskId) throw new Error("An agent cannot wait for itself.");
  }
  if ((await lockSwarmWorkflowInTx(client, context.workflowTaskId)).completed) {
    throw new Error("The Agent Swarm workflow is already completed.");
  }
  const pauses = await loadSwarmPausesInTx(client, context.workflowTaskId);
  delete pauses[context.taskId];
  const finished = collectWakesForFinishedAgent(context, pauses, context.taskId);
  await assertWaitTargetsRunning(client, context, {
    waitingForTaskIds,
    pauses,
    wakingTaskIds: new Set(finished.wakes.map((wake) => wake.taskId))
  });
  await saveFinishedAgentWakesInTx(client, context.workflowTaskId, finished);
  await saveSwarmPauseInTx(client, context.workflowTaskId, context.taskId, {
    swarmNodeId: dualRole ? target.nodeId : null,
    sinceMessageNo: context.swarm?.latestWorkflowMessageNo ?? 0,
    status: input.status.trim() || "Paused.",
    waitingForTaskIds,
    finishedTaskIds: [],
    triggerSource: input.triggerSource,
    selectionUserId: input.selectionUserId,
    mode: context.currentAgent?.role === "leader" ? "agent_swarm_leader" : "agent_swarm_worker"
  });
  return finished.wakes;
}

// Returns the text to hand back to the user when this pause leaves the whole swarm stalled for a
// second time.
export async function pauseSwarmAgent(input: {
  context: LoadedWorkflowRunContext;
  triggerSource: TaskExecutionJob["triggerSource"];
  selectionUserId: string | null;
  status: string;
  targetSwarm?: SwarmTarget;
  waitingForTaskIds?: string[] | null;
}): Promise<{ escalation: string | null }> {
  const { context } = input;
  if (context.workflowType !== "agent_swarm" || !context.currentAgent) {
    throw new Error("Swarm pause is only available to Agent Swarm agents.");
  }

  const wakes = await withTransaction((client) => persistSwarmPause(client, input));
  const label = formatSwarmAgentLabel(context.currentAgent.role, context.currentAgent.slot_index, context.currentAgent.title);
  await emitSwarmActivityEvent(context.workflowTaskId, context.taskId, `${label} paused: ${input.status.trim()}`);
  await enqueueSwarmWakes(context, wakes, `Swarm agent resumed because ${label} finished its work.`);
  return { escalation: await maybeResumeStalledSwarm(context) };
}

// A nested leader publishing its node's output has finished, even before it pauses.
export async function markSwarmAgentFinished(context: LoadedWorkflowRunContext): Promise<void> {
  const wakes = await withTransaction(async (client) => {
    if ((await lockSwarmWorkflowInTx(client, context.workflowTaskId)).completed) return [];
    const pauses = await loadSwarmPausesInTx(client, context.workflowTaskId);
    const finished = collectWakesForFinishedAgent(context, pauses, context.taskId);
    await saveFinishedAgentWakesInTx(client, context.workflowTaskId, finished);
    return finished.wakes;
  });
  await enqueueSwarmWakes(context, wakes, `Swarm agent resumed because ${agentLabel(context, context.taskId)} published its output.`);
}

// A message wakes its intended readers: members of a direct or group channel, or the workers of a
// node whose leader posts in that node's own channel. Global is passive; leaders assign work there
// with assign_worker, which starts the workers explicitly.
export async function maybeWakePausedSwarmAgentsAfterMessage(
  context: LoadedWorkflowRunContext,
  input: {
    channelId: string;
    channelMemberTaskIds: string[];
    senderTaskId: string;
    messageNo: number;
  }
): Promise<void> {
  const node = resolveSwarmNodeChannel(context, input.channelId);
  const isGlobalChannel = context.swarm?.globalChannelId === input.channelId;
  const wakes = await withTransaction(async (client) => {
    if ((await lockSwarmWorkflowInTx(client, context.workflowTaskId)).completed) return [];
    const pauses = await loadSwarmPausesInTx(client, context.workflowTaskId);
    const found: SwarmWake[] = [];

    for (const [taskId, pause] of Object.entries(pauses)) {
      if (taskId === input.senderTaskId || input.messageNo <= pause.sinceMessageNo) continue;
      const shouldWake = node
        ? !isGlobalChannel && input.senderTaskId === node.leaderTaskId && node.workerTaskIds.includes(taskId)
        : input.channelMemberTaskIds.includes(taskId);
      if (!shouldWake) continue;
      found.push({ taskId, ...pause });
    }
    await deleteSwarmPausesInTx(client, context.workflowTaskId, found.map((wake) => wake.taskId));
    return found;
  });
  await enqueueSwarmWakes(context, wakes, "Swarm agent resumed because relevant swarm mail arrived.");
}

// Only a paused agent is re-queued. A running agent picks up new swarm mail on its next inbox
// refresh; queueing a second run for it would fork its conversation history.
export async function wakePausedSwarmAgent(
  context: LoadedWorkflowRunContext,
  taskId: string,
  activityMessage: string
): Promise<boolean> {
  const pause = await withTransaction(async (client) => {
    if ((await lockSwarmWorkflowInTx(client, context.workflowTaskId)).completed) return null;
    return takeSwarmPauseInTx(client, context.workflowTaskId, taskId);
  });
  if (!pause) return false;
  await enqueueSwarmWakes(context, [{ taskId, ...pause }], activityMessage);
  return true;
}

export async function clearSwarmPauseOnRunStart(taskId: string): Promise<void> {
  await withTransaction(async (client) => {
    const taskResult = await client.query<{ workflow_type: string | null; workflow_parent_task_id: string | null }>(
      `SELECT workflow_type, workflow_parent_task_id FROM tasks WHERE id = $1`,
      [taskId]
    );
    const task = taskResult.rows[0] ?? null;
    if (task?.workflow_type !== "agent_swarm") return;

    const workflowTaskId = task.workflow_parent_task_id ?? taskId;
    await lockSwarmWorkflowInTx(client, workflowTaskId);
    await deleteSwarmPausesInTx(client, workflowTaskId, [taskId]);
    await clearSwarmStallAfterProgressInTx(client, workflowTaskId, taskId);
  });
}

export async function removeSwarmPauses(
  client: PoolClient,
  workflowTaskId: string,
  taskIds: string[]
): Promise<void> {
  await lockSwarmWorkflowInTx(client, workflowTaskId);
  await deleteSwarmPausesInTx(client, workflowTaskId, taskIds);
}
