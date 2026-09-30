import type { PoolClient } from "pg";
import type { TaskExecutionJob } from "@meowbert/shared";
import { withTransaction } from "../../lib/db.js";
import { emitTaskEvent } from "../runtime/events.js";
import type { LoadedWorkflowRunContext } from "./context-types.js";
import { hasDualSwarmRole, resolveSwarmTarget, type SwarmTarget } from "./swarm-target.js";
import {
  findSwarmWaitCycle,
  parseSwarmPauses,
  type StoredSwarmPause,
  type StoredSwarmPauseMap
} from "./agent-swarm-dependencies.js";
import {
  asObject,
  coerceNullableString,
  enqueueWorkflowTaskRun,
  formatSwarmAgentLabel,
  getSwarmToolOptionsOverride,
  isSwarmTaskActiveStatus
} from "./shared.js";

interface SwarmNodeChannel {
  leaderTaskId: string;
  workerTaskIds: string[];
}

async function emitSwarmActivityEvent(workflowTaskId: string, taskId: string, message: string): Promise<void> {
  await emitTaskEvent(taskId, "log", { message });
  if (taskId !== workflowTaskId) {
    await emitTaskEvent(workflowTaskId, "log", { message });
  }
}

function buildSwarmState(
  currentState: Record<string, unknown>,
  pausedSwarmAgents: StoredSwarmPauseMap
): Record<string, unknown> {
  const nextState: Record<string, unknown> = {
    ...currentState,
    pausedSwarmAgents
  };
  delete nextState.pendingSwarmWaits;
  return nextState;
}

function resolveLeafTaskIds(context: LoadedWorkflowRunContext): Map<string, string> {
  return new Map(context.agents.flatMap((agent) => {
    const leafId = coerceNullableString(agent.state_json.swarmLeafId);
    return leafId ? [[leafId, agent.task_id] as const] : [];
  }));
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
    const leafTaskIds = resolveLeafTaskIds(context);
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

function resolveExpectedReportTaskIds(
  context: LoadedWorkflowRunContext,
  channelId: string | null,
  currentState: Record<string, unknown>
): string[] {
  if (!channelId || !context.currentAgent) {
    return [];
  }

  const node = resolveSwarmNodeChannel(context, channelId);
  if (!node || node.leaderTaskId !== context.currentAgent.task_id) {
    return [];
  }

  const startedTaskIds = resolveStartedSwarmWorkerTaskIds(context, currentState);
  const activeTaskIds = new Set(
    context.agents
      .filter((agent) => isSwarmTaskActiveStatus(agent.status) && startedTaskIds.has(agent.task_id))
      .map((agent) => agent.task_id)
  );
  return node.workerTaskIds.filter((taskId) => activeTaskIds.has(taskId));
}

function resolveStartedSwarmWorkerTaskIds(
  context: LoadedWorkflowRunContext,
  currentState: Record<string, unknown>
): Set<string> {
  if (Array.isArray(currentState.startedSwarmWorkerTaskIds)) {
    return new Set(currentState.startedSwarmWorkerTaskIds.filter((id): id is string => typeof id === "string"));
  }
  return currentState.workersStartedAt
    ? new Set(context.agents.filter((agent) => agent.role === "worker").map((agent) => agent.task_id))
    : new Set();
}

export async function persistSwarmPause(
  client: PoolClient,
  input: {
    context: LoadedWorkflowRunContext;
    sinceMessageNo: number;
    channelId: string | null;
    triggerSource: TaskExecutionJob["triggerSource"];
    selectionUserId: string | null;
    status: string;
    targetSwarm?: SwarmTarget;
    waitingForTaskIds?: string[] | null;
  }
): Promise<void> {
  const target = resolveSwarmTarget(input.context, input.targetSwarm);
  const dualRole = hasDualSwarmRole(input.context);
  const rosterIds = new Set(dualRole
    ? target.memberTaskIds
    : input.context.agents.map((agent) => agent.task_id));
  const waitingForTaskIds = Array.from(new Set(input.waitingForTaskIds ?? []));
  for (const taskId of waitingForTaskIds) {
    if (!rosterIds.has(taskId)) throw new Error(`Unknown swarm wait dependency: ${taskId}`);
  }
  const workflowResult = await client.query<{ phase: string | null; state_json: Record<string, unknown> | null }>(
    `SELECT state_json, phase FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
    [input.context.workflowTaskId]
  );
  if (workflowResult.rows[0]?.phase === "completed") {
    throw new Error("The Agent Swarm workflow is already completed.");
  }
  const currentState = asObject(workflowResult.rows[0]?.state_json);
  const pausedSwarmAgents = parseSwarmPauses(currentState);
  pausedSwarmAgents[input.context.taskId] = {
    swarmNodeId: dualRole ? target.nodeId : null,
    sinceMessageNo: input.sinceMessageNo,
    status: input.status.trim() || "Paused.",
    waitingForTaskIds,
    expectedReportTaskIds: resolveExpectedReportTaskIds(input.context, input.channelId, currentState),
    receivedReportTaskIds: [],
    triggerSource: input.triggerSource,
    selectionUserId: input.selectionUserId,
    mode: input.context.currentAgent?.role === "leader" ? "agent_swarm_leader" : "agent_swarm_worker"
  };
  await client.query(
    `UPDATE task_workflows SET state_json = $2::jsonb, updated_at = now() WHERE task_id = $1`,
    [input.context.workflowTaskId, JSON.stringify(buildSwarmState(currentState, pausedSwarmAgents))]
  );
}

export async function pauseSwarmAgent(input: {
  context: LoadedWorkflowRunContext;
  triggerSource: TaskExecutionJob["triggerSource"];
  selectionUserId: string | null;
  status: string;
  targetSwarm?: SwarmTarget;
  waitingForTaskIds?: string[] | null;
}): Promise<void> {
  if (input.context.workflowType !== "agent_swarm" || !input.context.currentAgent) {
    throw new Error("Swarm pause is only available to Agent Swarm agents.");
  }

  const target = resolveSwarmTarget(input.context, input.targetSwarm);
  await withTransaction((client) => persistSwarmPause(client, {
    context: input.context,
    sinceMessageNo: input.context.swarm?.latestWorkflowMessageNo ?? 0,
    channelId: hasDualSwarmRole(input.context) ? target.channelId : null,
    triggerSource: input.triggerSource,
    selectionUserId: input.selectionUserId,
    status: input.status,
    targetSwarm: input.targetSwarm,
    waitingForTaskIds: input.waitingForTaskIds
  }));
  await maybeResumeSwarmWaitCycle(input.context);
  await emitSwarmActivityEvent(
    input.context.workflowTaskId,
    input.context.taskId,
    `${formatSwarmAgentLabel(
      input.context.currentAgent.role,
      input.context.currentAgent.slot_index,
      input.context.currentAgent.title
    )} paused: ${input.status.trim()}`
  );
  await maybeResumeStalledSwarm(input.context);
}

export async function emitSwarmPausedAfterMessage(context: LoadedWorkflowRunContext): Promise<void> {
  if (!context.currentAgent) return;
  await emitSwarmActivityEvent(
    context.workflowTaskId,
    context.taskId,
    `${formatSwarmAgentLabel(
      context.currentAgent.role,
      context.currentAgent.slot_index,
      context.currentAgent.title
    )} paused after sending a swarm message.`
  );
}

function shouldWakeNodeParticipant(input: {
  node: SwarmNodeChannel;
  pausedTaskId: string;
  senderTaskId: string;
}): boolean {
  return input.senderTaskId === input.node.leaderTaskId
    && input.node.workerTaskIds.includes(input.pausedTaskId);
}

function isDualRoleSwarmTask(context: LoadedWorkflowRunContext, taskId: string): boolean {
  const agent = context.agents.find((candidate) => candidate.task_id === taskId);
  const nodeIds = agent?.state_json.swarmNodeIds;
  const leaderNodeIds = agent?.state_json.swarmLeaderNodeIds;
  return Array.isArray(nodeIds)
    && nodeIds.length === 2
    && Array.isArray(leaderNodeIds)
    && leaderNodeIds.length > 0;
}

function recordNodeReport(
  pause: StoredSwarmPause,
  node: SwarmNodeChannel,
  pausedTaskId: string,
  senderTaskId: string,
  messageNo: number
): boolean {
  if (
    pausedTaskId !== node.leaderTaskId
    || !node.workerTaskIds.includes(senderTaskId)
    || messageNo <= pause.sinceMessageNo
  ) {
    return false;
  }
  if (pause.expectedReportTaskIds.length === 0) {
    return true;
  }
  if (!pause.expectedReportTaskIds.includes(senderTaskId)) {
    return false;
  }
  if (!pause.receivedReportTaskIds.includes(senderTaskId)) {
    pause.receivedReportTaskIds.push(senderTaskId);
  }
  return pause.expectedReportTaskIds.every((taskId) => pause.receivedReportTaskIds.includes(taskId));
}

export async function maybeWakePausedSwarmAgentsAfterMessage(
  context: LoadedWorkflowRunContext,
  input: {
    swarmNodeId?: string | null;
    channelId: string;
    channelMemberTaskIds: string[];
    senderTaskId: string;
    messageNo: number;
    senderCompletedWork: boolean;
  }
): Promise<void> {
  const node = resolveSwarmNodeChannel(context, input.channelId);
  const isGlobalChannel = context.swarm?.globalChannelId === input.channelId;
  const wakeEntries = await withTransaction(async (client) => {
    const workflowResult = await client.query<{ phase: string | null; state_json: Record<string, unknown> | null }>(
      `SELECT state_json, phase FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
      [context.workflowTaskId]
    );
    if (workflowResult.rows[0]?.phase === "completed") return [];
    const currentState = asObject(workflowResult.rows[0]?.state_json);
    const pausedSwarmAgents = parseSwarmPauses(currentState);
    const wakes: Array<StoredSwarmPause & { taskId: string }> = [];

    for (const [taskId, pause] of Object.entries(pausedSwarmAgents)) {
      if (taskId === input.senderTaskId || input.messageNo <= pause.sinceMessageNo) continue;
      const sameSwarm = !pause.swarmNodeId || pause.swarmNodeId === input.swarmNodeId;
      const canWakeDualRoleFromOtherSwarm = !sameSwarm
        && isDualRoleSwarmTask(context, taskId)
        && input.senderCompletedWork
        && node !== null;
      if (!sameSwarm && !canWakeDualRoleFromOtherSwarm) continue;
      const shouldWake = node
        ? (!isGlobalChannel && shouldWakeNodeParticipant({ node, pausedTaskId: taskId, senderTaskId: input.senderTaskId }))
          || (input.senderCompletedWork
            && recordNodeReport(pause, node, taskId, input.senderTaskId, input.messageNo))
        : input.channelMemberTaskIds.includes(taskId);
      if (!shouldWake) continue;
      wakes.push({ taskId, ...pause });
      delete pausedSwarmAgents[taskId];
    }

    const nextState = buildSwarmState(currentState, pausedSwarmAgents);
    delete nextState.lastSwarmStallSignature;
    await client.query(
      `UPDATE task_workflows SET state_json = $2::jsonb, updated_at = now() WHERE task_id = $1`,
      [context.workflowTaskId, JSON.stringify(nextState)]
    );
    return wakes;
  });

  for (const wake of wakeEntries) {
    try {
      await enqueueWorkflowTaskRun({
        taskId: wake.taskId,
        workspaceId: context.workspaceId,
        environmentId: context.environmentId,
        triggerSource: wake.triggerSource,
        mode: wake.mode,
        selectionUserId: wake.selectionUserId ?? undefined,
        toolOptionsOverride: getSwarmToolOptionsOverride(context)
      });
      await emitSwarmActivityEvent(
        context.workflowTaskId,
        wake.taskId,
        "Swarm agent resumed because relevant swarm mail arrived."
      );
    } catch (error) {
      console.error(`Failed to enqueue resumed swarm agent ${wake.taskId}`, error);
      await restoreSwarmPause(context.workflowTaskId, wake.taskId, wake);
    }
  }
}

// Only a paused agent is re-queued. A running agent picks up new swarm mail on its next inbox
// refresh; queueing a second run for it would fork its conversation history.
export async function wakePausedSwarmAgent(
  context: LoadedWorkflowRunContext,
  taskId: string,
  activityMessage: string
): Promise<boolean> {
  const pause = await withTransaction(async (client) => {
    const workflowResult = await client.query<{ phase: string | null; state_json: Record<string, unknown> | null }>(
      `SELECT state_json, phase FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
      [context.workflowTaskId]
    );
    if (workflowResult.rows[0]?.phase === "completed") return null;
    const currentState = asObject(workflowResult.rows[0]?.state_json);
    const pausedSwarmAgents = parseSwarmPauses(currentState);
    const stored = pausedSwarmAgents[taskId];
    if (!stored) return null;
    delete pausedSwarmAgents[taskId];
    const nextState = buildSwarmState(currentState, pausedSwarmAgents);
    delete nextState.lastSwarmStallSignature;
    await client.query(
      `UPDATE task_workflows SET state_json = $2::jsonb, updated_at = now() WHERE task_id = $1`,
      [context.workflowTaskId, JSON.stringify(nextState)]
    );
    return stored;
  });
  if (!pause) return false;

  try {
    await enqueueWorkflowTaskRun({
      taskId,
      workspaceId: context.workspaceId,
      environmentId: context.environmentId,
      triggerSource: pause.triggerSource,
      mode: pause.mode,
      selectionUserId: pause.selectionUserId ?? undefined,
      toolOptionsOverride: getSwarmToolOptionsOverride(context)
    });
  } catch (error) {
    console.error(`Failed to enqueue resumed swarm agent ${taskId}`, error);
    await restoreSwarmPause(context.workflowTaskId, taskId, pause);
    return false;
  }
  await emitSwarmActivityEvent(context.workflowTaskId, taskId, activityMessage);
  return true;
}

async function restoreSwarmPause(
  workflowTaskId: string,
  taskId: string,
  pause: StoredSwarmPause
): Promise<void> {
  await withTransaction(async (client) => {
    const workflowResult = await client.query<{ phase: string | null; state_json: Record<string, unknown> | null }>(
      `SELECT state_json, phase FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
      [workflowTaskId]
    );
    if (workflowResult.rows[0]?.phase === "completed") return;
    const currentState = asObject(workflowResult.rows[0]?.state_json);
    const pausedSwarmAgents = parseSwarmPauses(currentState);
    pausedSwarmAgents[taskId] = {
      swarmNodeId: pause.swarmNodeId,
      sinceMessageNo: pause.sinceMessageNo,
      status: pause.status,
      waitingForTaskIds: pause.waitingForTaskIds,
      expectedReportTaskIds: pause.expectedReportTaskIds,
      receivedReportTaskIds: pause.receivedReportTaskIds,
      triggerSource: pause.triggerSource,
      selectionUserId: pause.selectionUserId,
      mode: pause.mode
    };
    const nextState = buildSwarmState(currentState, pausedSwarmAgents);
    if (pause.mode === "agent_swarm_leader") delete nextState.lastSwarmWaitCycleSignature;
    await client.query(
      `UPDATE task_workflows SET state_json = $2::jsonb, updated_at = now() WHERE task_id = $1`,
      [workflowTaskId, JSON.stringify(nextState)]
    );
  }).catch((error) => {
    console.error(`Failed to restore swarm pause for agent ${taskId}`, error);
  });
}

function buildSwarmStallSignature(pauses: StoredSwarmPauseMap): string {
  return Object.entries(pauses)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([taskId, pause]) => `${taskId}:${pause.sinceMessageNo}`)
    .join("|");
}

function resolvePendingNestedLeaderTaskIds(context: LoadedWorkflowRunContext): string[] {
  const pendingNodeIds = context.swarm?.pendingNestedSwarmNodeIds ?? [];
  if (pendingNodeIds.length === 0) return [];

  const compiled = asObject(context.config.compiledSwarm);
  const nodes = Array.isArray(compiled.nodes) ? compiled.nodes.map(asObject) : [];
  const taskIdByLeafId = resolveLeafTaskIds(context);
  return pendingNodeIds.flatMap((nodeId) => {
    const node = nodes.find((candidate) => candidate.id === nodeId);
    const leaderTaskId = typeof node?.leaderLeafId === "string"
      ? taskIdByLeafId.get(node.leaderLeafId)
      : null;
    return leaderTaskId ? [leaderTaskId] : [];
  });
}

function resolveWaitCycleLeaderTaskId(context: LoadedWorkflowRunContext, cycleTaskIds: string[]): string | null {
  const rootLeaderTaskId = context.agents.find((agent) => agent.role === "leader")?.task_id ?? null;
  const members = cycleTaskIds.slice(0, -1)
    .map((taskId) => context.agents.find((agent) => agent.task_id === taskId));
  if (members.some((agent) => !agent)) return rootLeaderTaskId;
  const nodeIds = members.map((agent) => Array.isArray(agent?.state_json?.swarmNodeIds)
    ? agent.state_json.swarmNodeIds.filter((id): id is string => typeof id === "string")
    : []);
  const commonNodeIds = nodeIds[0]?.filter((id) => nodeIds.every((ids) => ids.includes(id))) ?? [];
  const compiled = asObject(context.config.compiledSwarm);
  const nodes = Array.isArray(compiled.nodes) ? compiled.nodes.map(asObject) : [];
  const node = nodes.find((candidate) => commonNodeIds.includes(candidate.id as string)
    && candidate.parentNodeId !== null)
    ?? nodes.find((candidate) => commonNodeIds.includes(candidate.id as string));
  const leader = context.agents.find((agent) => agent.state_json?.swarmLeafId === node?.leaderLeafId);
  return leader?.task_id ?? rootLeaderTaskId;
}

export async function maybeResumeSwarmWaitCycle(context: LoadedWorkflowRunContext): Promise<void> {
  if (context.workflowType !== "agent_swarm" || context.phase === "completed") return;

  const wake = await withTransaction(async (client) => {
    const workflowResult = await client.query<{ phase: string | null; state_json: Record<string, unknown> | null }>(
      `SELECT state_json, phase FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
      [context.workflowTaskId]
    );
    if (workflowResult.rows[0]?.phase === "completed") return null;
    const currentState = asObject(workflowResult.rows[0]?.state_json);
    const pauses = parseSwarmPauses(currentState);
    const cycleTaskIds = findSwarmWaitCycle(pauses, context.taskId);
    if (!cycleTaskIds) return null;
    const leaderTaskId = resolveWaitCycleLeaderTaskId(context, cycleTaskIds);
    if (!leaderTaskId) return null;
    const leaderPause = pauses[leaderTaskId];
    if (!leaderPause) return null;

    const signature = cycleTaskIds.slice(0, -1).sort()
      .map((taskId) => `${taskId}:${pauses[taskId].sinceMessageNo}:${pauses[taskId].waitingForTaskIds.join(",")}:${pauses[taskId].expectedReportTaskIds.join(",")}:${pauses[taskId].receivedReportTaskIds.join(",")}`)
      .join("|");
    if (currentState.lastSwarmWaitCycleSignature === signature) return null;

    delete pauses[leaderTaskId];
    await client.query(
      `UPDATE task_workflows SET state_json = $2::jsonb, updated_at = now() WHERE task_id = $1`,
      [context.workflowTaskId, JSON.stringify({
        ...buildSwarmState(currentState, pauses),
        lastSwarmWaitCycleSignature: signature,
        lastSwarmWaitCycleTaskIds: cycleTaskIds
      })]
    );
    return { leaderTaskId, pause: leaderPause, cycleTaskIds };
  });
  if (!wake) return;

  try {
    await enqueueWorkflowTaskRun({
      taskId: wake.leaderTaskId,
      workspaceId: context.workspaceId,
      environmentId: context.environmentId,
      triggerSource: wake.pause.triggerSource,
      mode: wake.pause.mode,
      selectionUserId: wake.pause.selectionUserId ?? undefined,
      toolOptionsOverride: getSwarmToolOptionsOverride(context)
    });
  } catch (error) {
    console.error(`Failed to enqueue swarm leader for wait cycle ${wake.leaderTaskId}`, error);
    await restoreSwarmPause(context.workflowTaskId, wake.leaderTaskId, wake.pause);
    return;
  }
  const labels = wake.cycleTaskIds.map((taskId) => {
    const agent = context.agents.find((candidate) => candidate.task_id === taskId);
    return agent ? formatSwarmAgentLabel(agent.role, agent.slot_index, agent.title) : taskId;
  });
  await emitSwarmActivityEvent(
    context.workflowTaskId,
    wake.leaderTaskId,
    `Swarm leader resumed to resolve a wait cycle: ${labels.join(" -> ")}.`
  );
}

export async function maybeResumeStalledSwarm(context: LoadedWorkflowRunContext): Promise<void> {
  if (context.workflowType !== "agent_swarm" || context.phase === "completed") return;
  const leaderTaskId = context.agents.find((agent) => agent.role === "leader")?.task_id ?? null;
  if (!leaderTaskId) return;

  const wake = await withTransaction(async (client) => {
    const workflowResult = await client.query<{ phase: string | null; state_json: Record<string, unknown> | null }>(
      `SELECT state_json, phase FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
      [context.workflowTaskId]
    );
    if (workflowResult.rows[0]?.phase === "completed") return null;
    const currentState = asObject(workflowResult.rows[0]?.state_json);
    const pausedSwarmAgents = parseSwarmPauses(currentState);
    const startedWorkerTaskIds = resolveStartedSwarmWorkerTaskIds(context, currentState);
    const activeTaskIds = context.agents
      .filter((agent) => isSwarmTaskActiveStatus(agent.status)
        && (agent.role === "leader" || startedWorkerTaskIds.has(agent.task_id)))
      .map((agent) => agent.task_id);
    if (activeTaskIds.length === 0 || activeTaskIds.some((taskId) => !pausedSwarmAgents[taskId])) return null;

    const signature = buildSwarmStallSignature(pausedSwarmAgents);
    if (currentState.lastSwarmStallSignature === signature) return null;
    const stalledTaskId = [
      ...resolvePendingNestedLeaderTaskIds(context),
      leaderTaskId
    ].find((taskId) => activeTaskIds.includes(taskId) && pausedSwarmAgents[taskId]);
    if (!stalledTaskId) return null;
    const stalledPause = pausedSwarmAgents[stalledTaskId];

    delete pausedSwarmAgents[stalledTaskId];
    await client.query(
      `UPDATE task_workflows SET state_json = $2::jsonb, updated_at = now() WHERE task_id = $1`,
      [context.workflowTaskId, JSON.stringify({
        ...buildSwarmState(currentState, pausedSwarmAgents),
        lastSwarmStallSignature: signature
      })]
    );
    return { taskId: stalledTaskId, pause: stalledPause };
  });
  if (!wake) return;

  try {
    await enqueueWorkflowTaskRun({
      taskId: wake.taskId,
      workspaceId: context.workspaceId,
      environmentId: context.environmentId,
      triggerSource: wake.pause.triggerSource,
      mode: wake.pause.mode,
      selectionUserId: wake.pause.selectionUserId ?? undefined,
      toolOptionsOverride: getSwarmToolOptionsOverride(context)
    });
    const resumedAgent = context.agents.find((agent) => agent.task_id === wake.taskId);
    const resumedLabel = resumedAgent
      ? formatSwarmAgentLabel(resumedAgent.role, resumedAgent.slot_index, resumedAgent.title)
      : wake.taskId;
    await emitSwarmActivityEvent(
      context.workflowTaskId,
      wake.taskId,
      `${resumedLabel} resumed because every active swarm agent was paused before the workflow completed.`
    );
  } catch (error) {
    console.error(`Failed to enqueue stalled swarm agent ${wake.taskId}`, error);
    await restoreSwarmPause(context.workflowTaskId, wake.taskId, wake.pause);
  }
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
    const workflowResult = await client.query<{ state_json: Record<string, unknown> | null }>(
      `SELECT state_json FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
      [workflowTaskId]
    );
    const currentState = asObject(workflowResult.rows[0]?.state_json);
    const pausedSwarmAgents = parseSwarmPauses(currentState);
    delete pausedSwarmAgents[taskId];
    const nextState = buildSwarmState(currentState, pausedSwarmAgents);
    delete nextState.lastSwarmStallSignature;
    delete nextState.lastSwarmWaitCycleSignature;
    delete nextState.lastSwarmWaitCycleTaskIds;
    await client.query(
      `UPDATE task_workflows SET state_json = $2::jsonb, updated_at = now() WHERE task_id = $1`,
      [workflowTaskId, JSON.stringify(nextState)]
    );
  });
}

export async function removeSwarmPauses(
  client: PoolClient,
  workflowTaskId: string,
  taskIds: string[]
): Promise<void> {
  const workflowResult = await client.query<{ state_json: Record<string, unknown> | null }>(
    `SELECT state_json FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
    [workflowTaskId]
  );
  const currentState = asObject(workflowResult.rows[0]?.state_json);
  const pausedSwarmAgents = parseSwarmPauses(currentState);
  for (const taskId of taskIds) delete pausedSwarmAgents[taskId];
  await client.query(
    `UPDATE task_workflows SET state_json = $2::jsonb, updated_at = now() WHERE task_id = $1`,
    [workflowTaskId, JSON.stringify(buildSwarmState(currentState, pausedSwarmAgents))]
  );
}
