import { randomUUID } from "node:crypto";
import {
  buildTaskRunQueueJobId,
  calculateAgentSwarmBudgetEstimate,
  calculateAgentSwarmInitialLeases,
  calculateAgentSwarmSystemReserve,
  AGENT_SWARM_MINIMUM_CHILD_NODE_TOKENS,
  AGENT_SWARM_MINIMUM_INFERENCE_TOKENS,
  AGENT_SWARM_MAX_ACTIVE_AGENTS,
  createTaskMessageMetadata,
  sumAgentSwarmAgentAllocations,
} from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import type { LoadedWorkflowRunContext } from "./context-types.js";
import { resolveSwarmTarget, type SwarmTarget } from "./swarm-target.js";
import {
  asObject,
  enqueueWorkflowTaskRun,
  getSwarmToolOptionsOverride,
  type WorkflowAgentRecord
} from "./shared.js";
import { calculateAgentSwarmMinimumGrant } from "@meowbert/shared";
import { reclaimCancelledSwarmBudgetInTx } from "./agent-swarm-budget-reclaim.js";
import { listAgentSwarmNodeTypes } from "./agent-swarm-node-types.js";

const MAX_ACTIVE_NODES = 256;
const MAX_NODE_DEPTH = 8;

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
}

function buildTaskRootPath(taskId: string): string {
  return `.meowbert/task-runs/${taskId}`;
}

function buildSwarmTaskSection(swarmTask: string, instruction: string | null): string {
  return [
    "",
    "The swarm task is:",
    "",
    swarmTask,
    instruction?.trim() ? ["", "Parent instruction:", instruction.trim()].join("\n") : null
  ].filter((line) => line !== null).join("\n");
}

function buildChildLeaderMessage(title: string, swarmTask: string, instruction: string | null): string {
  return [
    `You are the leader of the Agent Swarm node "${title}".`,
    "This is a dynamically spawned child node. Work on the assigned task, coordinate any workers in this node, and report the finished result to your parent leader.",
    buildSwarmTaskSection(swarmTask, instruction)
  ].join("\n");
}

function buildChildWorkerMessage(title: string, swarmTask: string, instruction: string | null, index: number): string {
  return [
    `You are Worker ${index + 1} in the dynamically spawned Agent Swarm node "${title}".`,
    "Work on the assigned objective, use the swarm channels, and report findings to your node leader.",
    buildSwarmTaskSection(swarmTask, instruction)
  ].join("\n");
}

async function loadSwarmTaskPrompt(client: import("pg").PoolClient, workflowTaskId: string, fallbackTitle: string | null): Promise<string> {
  const message = await client.query<{ text: string | null }>(
    `SELECT content_json->>'text' AS text
       FROM task_messages
      WHERE task_id = $1 AND role = 'user'
      ORDER BY created_at ASC
      LIMIT 1`,
    [workflowTaskId]
  );
  return message.rows[0]?.text?.trim() || fallbackTitle?.trim() || "Execute the assigned swarm task.";
}

function readCompiledSwarm(context: LoadedWorkflowRunContext): {
  rootNodeId: string;
  nodes: Array<Record<string, unknown>>;
  leaves: Array<Record<string, unknown>>;
} {
  const compiled = asObject(context.config.compiledSwarm);
  const rootNodeId = typeof compiled.rootNodeId === "string" ? compiled.rootNodeId : "node-0";
  const nodes = Array.isArray(compiled.nodes) ? compiled.nodes.map(asObject) : [];
  const leaves = Array.isArray(compiled.leaves) ? compiled.leaves.map(asObject) : [];
  return { rootNodeId, nodes, leaves };
}

// Child deadlines only narrow a parent deadline; without one, requested minutes are ignored.
function deadlineFromMinutes(parentDeadlineAt: string | null, minutes: number | null): string | null {
  if (!parentDeadlineAt) return null;
  if (!minutes) return parentDeadlineAt;
  return new Date(Math.min(Date.now() + minutes * 60_000, Date.parse(parentDeadlineAt))).toISOString();
}

async function insertChildTask(client: import("pg").PoolClient, input: {
  taskId: string;
  workflowTaskId: string;
  parentTaskId: string;
  workspaceId: string;
  environmentId: string;
  initiatorUserId: string;
  defaultTimezone: string;
  allowWaiting: boolean;
  title: string;
  message: string;
  workflowInternalRole: "leader" | "worker";
}): Promise<void> {
  const createdAt = new Date().toISOString();
  await client.query(
    `INSERT INTO tasks (
      id, workspace_id, environment_id, title, status, source,
      initiator_user_id, default_timezone, allow_waiting, task_root_path,
      workflow_type, workflow_parent_task_id, workflow_internal_role
    ) VALUES ($1, $2, $3, $4, 'queued', 'web', $5, $6, $7, $8, 'agent_swarm', $9, $10)`,
    [
      input.taskId,
      input.workspaceId,
      input.environmentId,
      input.title,
      input.initiatorUserId,
      input.defaultTimezone,
      input.allowWaiting,
      buildTaskRootPath(input.taskId),
      input.parentTaskId,
      input.workflowInternalRole
    ]
  );
  await client.query(
    `INSERT INTO task_messages (task_id, role, content_json, message_metadata_json, created_at)
     VALUES ($1, 'system', $2::jsonb, $3::jsonb, $4)`,
    [
      input.taskId,
      JSON.stringify({ text: input.message }),
      JSON.stringify(createTaskMessageMetadata(createdAt)),
      createdAt
    ]
  );
}

async function insertSwarmAgent(client: import("pg").PoolClient, input: {
  workflowTaskId: string;
  taskId: string;
  role: "leader" | "worker";
  slotIndex: number;
  state: Record<string, unknown>;
}): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO task_workflow_agents (workflow_task_id, role, slot_index, task_id, state_json)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id`,
    [input.workflowTaskId, input.role, input.slotIndex, input.taskId, JSON.stringify(input.state)]
  );
  return result.rows[0].id;
}

function buildSpawnedAgentRecord(input: {
  id: string;
  role: "leader" | "worker";
  slotIndex: number;
  taskId: string;
  title: string;
  state: Record<string, unknown>;
}): WorkflowAgentRecord {
  return {
    id: input.id,
    role: input.role,
    slot_index: input.slotIndex,
    task_id: input.taskId,
    title: input.title,
    status: "queued",
    task_root_path: buildTaskRootPath(input.taskId),
    last_inbox_refresh_message_no: 0,
    state_json: input.state
  };
}

// The spawned leader runs immediately, so it counts as started: the parent must wait for its output
// before finishing, and stall detection must treat it as an active agent.
function markSpawnedLeaderStarted(
  context: LoadedWorkflowRunContext,
  state: Record<string, unknown>,
  leaderTaskId: string
): Record<string, unknown> {
  const startedIds = Array.isArray(state.startedSwarmWorkerTaskIds)
    ? state.startedSwarmWorkerTaskIds.filter((id): id is string => typeof id === "string")
    : state.workersStartedAt
      ? context.agents.filter((agent) => agent.role === "worker").map((agent) => agent.task_id)
      : [];
  const nextState: Record<string, unknown> = {
    ...state,
    startedSwarmWorkerTaskIds: Array.from(new Set([...startedIds, leaderTaskId]))
  };
  return nextState;
}

function applySpawnToContext(context: LoadedWorkflowRunContext, spawn: {
  nodeKey: string;
  config: Record<string, unknown>;
  agents: WorkflowAgentRecord[];
}): void {
  context.config = spawn.config;
  context.agents.push(...spawn.agents);
  if (context.swarm) {
    context.swarm.pendingNestedSwarmNodeIds = [...(context.swarm.pendingNestedSwarmNodeIds ?? []), spawn.nodeKey];
  }
}

function assertLeader(context: LoadedWorkflowRunContext, targetSwarm?: SwarmTarget): ReturnType<typeof resolveSwarmTarget> {
  const target = resolveSwarmTarget(context, targetSwarm);
  if (!target.isLeader) throw new Error("Only an Agent Swarm node leader can manage child nodes.");
  return target;
}

export async function spawnSwarmNode(input: {
  context: LoadedWorkflowRunContext;
  targetSwarm?: SwarmTarget;
  nodeTypeId: string;
  title: string;
  initialInstruction: string | null;
  tokenBudget: number;
  timeBudgetMinutes: number | null;
}): Promise<{
  nodeId: string;
  title: string;
  status: string;
  leaderTaskId: string;
  workerTaskIds: string[];
  allocatedTokens: number;
  deadlineAt: string | null;
}> {
  const parentTarget = assertLeader(input.context, input.targetSwarm);
  const parentNodeKey = parentTarget.nodeId;
  if (!parentNodeKey) throw new Error("Dynamic child nodes require a budgeted Swarm root.");
  const nodeType = listAgentSwarmNodeTypes(input.context.config.dynamicNodeTypes).find((entry) => entry.id === input.nodeTypeId);
  if (!nodeType) throw new Error(`Unknown or non-spawnable Swarm node type: ${input.nodeTypeId}`);
  const workerCount = sumAgentSwarmAgentAllocations(nodeType.modelAllocations);
  const estimate = calculateAgentSwarmBudgetEstimate({ minimumStepTokens: AGENT_SWARM_MINIMUM_INFERENCE_TOKENS, workerSlots: workerCount });
  const reserveTokens = calculateAgentSwarmSystemReserve(input.tokenBudget, estimate.minimumStepTokens);
  const minimumBudget = Math.max(AGENT_SWARM_MINIMUM_CHILD_NODE_TOKENS, reserveTokens + estimate.minimumSpawnAllocationTokens);
  if (input.tokenBudget < minimumBudget) {
    throw new Error(`Spawn allocation too small. Minimum required is ${minimumBudget} weighted tokens.`);
  }

  const result = await withTransaction(async (client) => {
    const parent = await client.query<{
      id: string;
      depth: number;
      status: string;
      next_generation: number;
      deadline_at: string | null;
      unassigned_tokens: string | number;
      workflow_task_id: string;
    }>(
      `SELECT id, depth, status,
              COALESCE((SELECT MAX(sibling.generation) + 1
                          FROM task_workflow_swarm_nodes sibling
                         WHERE sibling.parent_node_id = n.id), 0)::int AS next_generation,
              deadline_at, unassigned_tokens, workflow_task_id
         FROM task_workflow_swarm_nodes n
        WHERE workflow_task_id = $1 AND node_key = $2
        FOR UPDATE`,
      [input.context.workflowTaskId, parentNodeKey]
    );
    const parentRow = parent.rows[0];
    if (!parentRow) throw new Error("Parent Swarm node could not be resolved.");
    if (parentRow.status !== "active") throw new Error("Parent Swarm node is not active.");
    if (parentRow.depth >= MAX_NODE_DEPTH) throw new Error(`Swarm depth limit of ${MAX_NODE_DEPTH} reached.`);
    if (numberValue(parentRow.unassigned_tokens) < input.tokenBudget) {
      throw new Error(`Parent has only ${numberValue(parentRow.unassigned_tokens)} unassigned weighted tokens available.`);
    }
    const activeCount = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM task_workflow_swarm_nodes
        WHERE workflow_task_id = $1 AND status IN ('active', 'paused')`,
      [input.context.workflowTaskId]
    );
    if (numberValue(activeCount.rows[0]?.count) >= MAX_ACTIVE_NODES) {
      throw new Error(`Swarm active-node limit of ${MAX_ACTIVE_NODES} reached.`);
    }
    const activeAgents = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
         FROM task_workflow_swarm_node_members member
         JOIN task_workflow_swarm_nodes node ON node.id = member.node_id
        WHERE node.workflow_task_id = $1 AND node.status IN ('active', 'paused')`,
      [input.context.workflowTaskId]
    );
    if (numberValue(activeAgents.rows[0]?.count) + workerCount + 1 > AGENT_SWARM_MAX_ACTIVE_AGENTS) {
      throw new Error(`Swarm active-agent limit of ${AGENT_SWARM_MAX_ACTIVE_AGENTS} reached.`);
    }

    const workflow = await client.query<{
      workspace_id: string;
      environment_id: string;
      initiator_user_id: string;
      default_timezone: string;
      allow_waiting: boolean;
      title: string | null;
      state_json: Record<string, unknown> | null;
      config_json: Record<string, unknown> | null;
    }>(
      `SELECT t.workspace_id, t.environment_id, t.initiator_user_id,
              t.default_timezone, t.allow_waiting, t.title,
              w.state_json, w.config_json
         FROM tasks t
         JOIN task_workflows w ON w.task_id = t.id
        WHERE t.id = $1
        FOR UPDATE`,
      [input.context.workflowTaskId]
    );
    const workflowRow = workflow.rows[0];
    if (!workflowRow?.initiator_user_id) throw new Error("Swarm initiator could not be resolved.");

    const nodeId = randomUUID();
    const nodeKey = nodeId;
    const leaderTaskId = randomUUID();
    const workerTaskIds = Array.from({ length: workerCount }, () => randomUUID());
    const parentDeadlineAt = parentRow.deadline_at;
    const deadlineAt = deadlineFromMinutes(parentDeadlineAt, input.timeBudgetMinutes);
    const childTitle = input.title.trim();
    const operatingTokens = Math.max(0, input.tokenBudget - reserveTokens);
    const { leaderLeaseTokens, workerLeaseTokens, unassignedTokens } = calculateAgentSwarmInitialLeases({
      operatingTokens,
      workerCount,
      minimumStepTokens: AGENT_SWARM_MINIMUM_INFERENCE_TOKENS
    });

    await client.query(
      `UPDATE task_workflow_swarm_nodes
          SET unassigned_tokens = unassigned_tokens - $2, updated_at = now()
        WHERE id = $1`,
      [parentRow.id, input.tokenBudget]
    );
    const leaderTitle = `${workflowRow.title?.trim() || "Agent Swarm"} · ${childTitle}`;
    const swarmTask = await loadSwarmTaskPrompt(client, input.context.workflowTaskId, workflowRow.title);
    await insertChildTask(client, {
      taskId: leaderTaskId,
      workflowTaskId: input.context.workflowTaskId,
      parentTaskId: input.context.workflowTaskId,
      workspaceId: workflowRow.workspace_id,
      environmentId: workflowRow.environment_id,
      initiatorUserId: workflowRow.initiator_user_id,
      defaultTimezone: workflowRow.default_timezone,
      allowWaiting: workflowRow.allow_waiting,
      title: leaderTitle,
      message: buildChildLeaderMessage(childTitle, swarmTask, input.initialInstruction),
      workflowInternalRole: "leader"
    });
    const leaderSlot = (await client.query<{ max: number | null }>(
      `SELECT MAX(slot_index)::int AS max FROM task_workflow_agents WHERE workflow_task_id = $1 AND role = 'leader'`,
      [input.context.workflowTaskId]
    )).rows[0]?.max;
    const leaderState = {
      agentPresetId: nodeType.leaderAgentId,
      agentPresetMode: nodeType.leaderAgentMode,
      swarmNodeIds: [nodeKey, parentNodeKey],
      swarmLeaderNodeIds: [nodeKey],
      swarmParentNodeId: nodeKey,
      swarmLeafId: `leader-${nodeKey}`
    };
    const leaderSlotIndex = (leaderSlot ?? -1) + 1;
    const leaderAgentId = await insertSwarmAgent(client, {
      workflowTaskId: input.context.workflowTaskId,
      taskId: leaderTaskId,
      role: "leader",
      slotIndex: leaderSlotIndex,
      state: leaderState
    });
    const spawnedAgents = [buildSpawnedAgentRecord({
      id: leaderAgentId, role: "leader", slotIndex: leaderSlotIndex, taskId: leaderTaskId, title: leaderTitle, state: leaderState
    })];

    await client.query(
      `INSERT INTO task_workflow_swarm_nodes (
        id, workflow_task_id, parent_node_id, node_type_id, node_key,
        generation, title, depth, status, leader_task_id,
        allocated_tokens, system_reserve_tokens, unassigned_tokens, deadline_at,
        created_by_workflow_agent_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10, $11, $12, $13, $14)`,
      [
        nodeId,
        input.context.workflowTaskId,
        parentRow.id,
        nodeType.id,
        nodeKey,
        parentRow.next_generation,
        childTitle,
        parentRow.depth + 1,
        leaderTaskId,
        input.tokenBudget,
        reserveTokens,
        unassignedTokens,
        deadlineAt,
        input.context.currentAgent?.id ?? leaderAgentId
      ]
    );
    await client.query(
      `INSERT INTO task_workflow_swarm_node_members
        (node_id, workflow_agent_id, role, slot_index, lease_tokens)
       VALUES ($1, $2, 'leader', 0, $3)`,
      [nodeId, leaderAgentId, leaderLeaseTokens]
    );

    const workerAgentIds: string[] = [];
    const workerLeafIds: string[] = [];
    const workerPresetIds = nodeType.modelAllocations.flatMap((allocation) =>
      Array.from({ length: allocation.workerCount }, () => allocation.agentId)
    );
    for (let index = 0; index < workerTaskIds.length; index += 1) {
      const workerTaskId = workerTaskIds[index];
      const leafId = `worker-${nodeKey}-${index}`;
      workerLeafIds.push(leafId);
      await insertChildTask(client, {
        taskId: workerTaskId,
        workflowTaskId: input.context.workflowTaskId,
        parentTaskId: input.context.workflowTaskId,
        workspaceId: workflowRow.workspace_id,
        environmentId: workflowRow.environment_id,
        initiatorUserId: workflowRow.initiator_user_id,
        defaultTimezone: workflowRow.default_timezone,
        allowWaiting: workflowRow.allow_waiting,
        title: `${childTitle} · Worker ${index + 1}`,
        message: buildChildWorkerMessage(childTitle, swarmTask, input.initialInstruction, index),
        workflowInternalRole: "worker"
      });
      const workerSlot = (await client.query<{ max: number | null }>(
        `SELECT MAX(slot_index)::int AS max FROM task_workflow_agents WHERE workflow_task_id = $1 AND role = 'worker'`,
        [input.context.workflowTaskId]
      )).rows[0]?.max;
      const workerState = {
        agentPresetId: workerPresetIds[index],
        agentPresetMode: nodeType.workerAgentModes[index] ?? "standard",
        swarmNodeIds: [nodeKey],
        swarmParentNodeId: nodeKey,
        swarmLeafId: leafId
      };
      const workerSlotIndex = (workerSlot ?? -1) + 1;
      const workerAgentId = await insertSwarmAgent(client, {
        workflowTaskId: input.context.workflowTaskId,
        taskId: workerTaskId,
        role: "worker",
        slotIndex: workerSlotIndex,
        state: workerState
      });
      workerAgentIds.push(workerAgentId);
      spawnedAgents.push(buildSpawnedAgentRecord({
        id: workerAgentId, role: "worker", slotIndex: workerSlotIndex, taskId: workerTaskId,
        title: `${childTitle} · Worker ${index + 1}`, state: workerState
      }));
      await client.query(
        `INSERT INTO task_workflow_swarm_node_members
          (node_id, workflow_agent_id, role, slot_index, lease_tokens)
         VALUES ($1, $2, 'worker', $3, $4)`,
        [nodeId, workerAgentId, index, workerLeaseTokens]
      );
    }

    await client.query(
      `INSERT INTO task_workflow_swarm_quota_ledger
        (workflow_task_id, node_id, parent_node_id, kind, amount_tokens, metadata_json)
       VALUES ($1, $2, $3, 'child_grant', $4, $5::jsonb)`,
      [input.context.workflowTaskId, nodeId, parentRow.id, input.tokenBudget, JSON.stringify({ nodeTypeId: nodeType.id })]
    );

    const channel = await client.query<{ id: string }>(
      `INSERT INTO task_workflow_channels
        (workflow_task_id, kind, title, created_by_workflow_agent_id)
       VALUES ($1, 'group', $2, $3)
       RETURNING id`,
      [input.context.workflowTaskId, childTitle, leaderAgentId]
    );
    for (const agentId of [leaderAgentId, ...workerAgentIds]) {
      await client.query(
        `INSERT INTO task_workflow_channel_members (channel_id, workflow_agent_id)
         VALUES ($1, $2)`,
        [channel.rows[0].id, agentId]
      );
    }
    if (parentTarget.channelId) {
      await client.query(
        `INSERT INTO task_workflow_channel_members (channel_id, workflow_agent_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [parentTarget.channelId, leaderAgentId]
      );
    }

    const compiled = readCompiledSwarm({ ...input.context, config: workflowRow.config_json ?? {} });
    const parentNode = compiled.nodes.find((node) => node.id === parentNodeKey);
    if (parentNode) {
      const parentWorkers = Array.isArray(parentNode.workerLeafIds)
        ? parentNode.workerLeafIds.filter((value): value is string => typeof value === "string")
        : [];
      parentNode.workerLeafIds = [...parentWorkers, `leader-${nodeKey}`];
    }
    compiled.nodes.push({
      id: nodeKey,
      parentNodeId: parentNodeKey,
      title: childTitle,
      leaderLeafId: `leader-${nodeKey}`,
      workerLeafIds,
      reviewRounds: nodeType.reviewRounds
    });
    compiled.leaves.push({
      id: `leader-${nodeKey}`,
      agentId: nodeType.leaderAgentId,
      name: `${childTitle} Leader`,
      mode: "standard",
      nodeIds: [parentNodeKey, nodeKey],
      leaderNodeIds: [nodeKey],
      parentNodeId: nodeKey
    });
    for (let index = 0; index < workerLeafIds.length; index += 1) {
      const workerAgentId = workerPresetIds[index];
      compiled.leaves.push({
        id: workerLeafIds[index],
        agentId: workerAgentId,
        name: `${childTitle} Worker ${index + 1}`,
        mode: "standard",
        nodeIds: [nodeKey],
        leaderNodeIds: [],
        parentNodeId: nodeKey
      });
    }
    const nextConfig = {
      ...(workflowRow.config_json ?? {}),
      compiledSwarm: { rootNodeId: compiled.rootNodeId, nodes: compiled.nodes, leaves: compiled.leaves },
      swarmChannelIds: { ...asObject(workflowRow.config_json?.swarmChannelIds), [nodeKey]: channel.rows[0].id }
    };
    const nextState = markSpawnedLeaderStarted(input.context, asObject(workflowRow.state_json), leaderTaskId);
    await client.query(
      `UPDATE task_workflows SET config_json = $2::jsonb, state_json = $3::jsonb, updated_at = now() WHERE task_id = $1`,
      [input.context.workflowTaskId, JSON.stringify(nextConfig), JSON.stringify(nextState)]
    );
    return { nodeId, nodeKey, title: childTitle, leaderTaskId, workerTaskIds, deadlineAt, nextConfig, spawnedAgents };
  });
  const { nextConfig, spawnedAgents, nodeKey, ...spawned } = result;
  applySpawnToContext(input.context, { nodeKey, config: nextConfig, agents: spawnedAgents });

  await enqueueWorkflowTaskRun({
    taskId: spawned.leaderTaskId,
    workspaceId: input.context.workspaceId,
    environmentId: input.context.environmentId,
    triggerSource: "web",
    mode: "agent_swarm_leader",
    selectionUserId: undefined,
    toolOptionsOverride: getSwarmToolOptionsOverride(input.context)
  });
  return { ...spawned, status: "active", allocatedTokens: input.tokenBudget };
}

export async function grantSwarmNodeBudget(input: {
  context: LoadedWorkflowRunContext;
  targetSwarm?: SwarmTarget;
  nodeId: string;
  additionalTokens: number;
  extendDeadlineMinutes: number | null;
}): Promise<{ nodeId: string; allocatedTokens: number; remainingTokens: number; deadlineAt: string | null; resumed: boolean; leaderTaskId: string | null }> {
  const parentTarget = assertLeader(input.context, input.targetSwarm);
  if (!parentTarget.nodeId) throw new Error("Budget grants require a budgeted Swarm root.");
  const result = await withTransaction(async (client) => {
    const parent = await client.query<{ id: string; status: string; unassigned_tokens: string | number; deadline_at: string | null }>(
      `SELECT id, status, unassigned_tokens, deadline_at
         FROM task_workflow_swarm_nodes
        WHERE workflow_task_id = $1 AND node_key = $2
        FOR UPDATE`,
      [input.context.workflowTaskId, parentTarget.nodeId]
    );
    const child = await client.query<{
      id: string;
      leader_task_id: string;
      allocated_tokens: string | number;
      system_reserve_tokens: string | number;
      spent_tokens: string | number;
      reserved_tokens: string | number;
      debt_tokens: string | number;
      deadline_at: string | null;
      status: string;
    }>(
      `SELECT id, leader_task_id, allocated_tokens, system_reserve_tokens, spent_tokens, reserved_tokens, debt_tokens, deadline_at, status
         FROM task_workflow_swarm_nodes
        WHERE workflow_task_id = $1 AND id = $2 AND parent_node_id = (SELECT id FROM task_workflow_swarm_nodes WHERE workflow_task_id = $1 AND node_key = $3)
        FOR UPDATE`,
      [input.context.workflowTaskId, input.nodeId, parentTarget.nodeId]
    );
    const parentRow = parent.rows[0];
    const childRow = child.rows[0];
    if (!parentRow || !childRow) throw new Error("Only direct child nodes can receive a budget grant.");
    if (parentRow.status !== "active") throw new Error("Parent Swarm node is not active.");
    if (childRow.status === "cancelled" || childRow.status === "completed") {
      throw new Error(`A ${childRow.status} Swarm node cannot receive more budget.`);
    }
    const members = await client.query<{ workflow_agent_id: string; role: "leader" | "worker" }>(
      `SELECT workflow_agent_id, role
         FROM task_workflow_swarm_node_members
        WHERE node_id = $1
        ORDER BY slot_index ASC
        FOR UPDATE`,
      [childRow.id]
    );
    if (members.rows.length === 0) throw new Error("Child Swarm node has no active budget members.");
    const recentUsage = await client.query<{ weighted_tokens: string | number | null }>(
      `SELECT weighted_tokens
         FROM user_token_usage_events
        WHERE task_id IN (
          SELECT task_id FROM task_workflow_agents
           WHERE id = ANY($1::uuid[])
        )
        ORDER BY occurred_at DESC, created_at DESC
        LIMIT 1`,
      [members.rows.map((member) => member.workflow_agent_id)]
    );
    const minimumStepTokens = Math.max(
      AGENT_SWARM_MINIMUM_INFERENCE_TOKENS,
      numberValue(recentUsage.rows[0]?.weighted_tokens)
    );
    if (numberValue(parentRow.unassigned_tokens) < input.additionalTokens) {
      throw new Error(`Parent has only ${numberValue(parentRow.unassigned_tokens)} unassigned weighted tokens available.`);
    }
    const nextAllocatedTokens = numberValue(childRow.allocated_tokens) + input.additionalTokens;
    const nextSystemReserveTokens = calculateAgentSwarmSystemReserve(nextAllocatedTokens, minimumStepTokens);
    const reserveDelta = Math.max(0, nextSystemReserveTokens - numberValue(childRow.system_reserve_tokens));
    const operatingGrantTokens = input.additionalTokens - reserveDelta;
    const minimum = calculateAgentSwarmMinimumGrant({
      allocatedTokens: nextAllocatedTokens,
      minimumStepTokens,
      workerSlots: Math.max(0, members.rows.length - 1),
      spawning: numberValue(childRow.allocated_tokens) === 0
    });
    const remainingAfterGrant = Math.max(
      0,
      nextAllocatedTokens
        - numberValue(childRow.spent_tokens)
        - numberValue(childRow.reserved_tokens)
        - numberValue(childRow.debt_tokens)
        - nextSystemReserveTokens
    );
    if (operatingGrantTokens < 0 || remainingAfterGrant < minimum - nextSystemReserveTokens) {
      throw new Error(`Grant too small. Minimum required to resume this node is ${minimum} weighted tokens.`);
    }
    const deadlineAt = input.extendDeadlineMinutes
      ? deadlineFromMinutes(parentRow.deadline_at, input.extendDeadlineMinutes)
      : childRow.deadline_at;
    if (deadlineAt && Date.parse(deadlineAt) <= Date.now()) {
      throw new Error("Child deadline has expired. Extend it within the parent deadline before resuming.");
    }
    const leases = calculateAgentSwarmInitialLeases({
      operatingTokens: operatingGrantTokens,
      workerCount: members.rows.filter((member) => member.role === "worker").length,
      minimumStepTokens
    });
    await client.query(
      `UPDATE task_workflow_swarm_nodes
          SET allocated_tokens = allocated_tokens + $2,
              system_reserve_tokens = $3,
              unassigned_tokens = unassigned_tokens + $4,
              status = CASE WHEN status = 'paused' THEN 'active' ELSE status END,
              paused_reason = NULL,
              deadline_at = COALESCE($5::timestamptz, deadline_at),
              updated_at = now()
        WHERE id = $1`,
      [childRow.id, input.additionalTokens, nextSystemReserveTokens, leases.unassignedTokens, deadlineAt]
    );
    for (const member of members.rows) {
      await client.query(
        `UPDATE task_workflow_swarm_node_members
            SET lease_tokens = lease_tokens + $2,
                status = CASE WHEN status = 'paused' THEN 'active' ELSE status END,
                updated_at = now()
          WHERE node_id = $1 AND workflow_agent_id = $3`,
        [childRow.id, member.role === "worker" ? leases.workerLeaseTokens : leases.leaderLeaseTokens, member.workflow_agent_id]
      );
    }
    await client.query(
      `UPDATE task_workflow_swarm_nodes
          SET unassigned_tokens = unassigned_tokens - $2, updated_at = now()
        WHERE id = $1`,
      [parentRow.id, input.additionalTokens]
    );
    await client.query(
      `INSERT INTO task_workflow_swarm_quota_ledger
        (workflow_task_id, node_id, parent_node_id, kind, amount_tokens, metadata_json)
       VALUES ($1, $2, $3, 'child_grant', $4, $5::jsonb)`,
      [input.context.workflowTaskId, childRow.id, parentRow.id, input.additionalTokens, JSON.stringify({ deadlineAt })]
    );
    return {
      nodeId: childRow.id,
      allocatedTokens: numberValue(childRow.allocated_tokens) + input.additionalTokens,
      remainingTokens: remainingAfterGrant,
      deadlineAt,
      resumed: childRow.status === "paused",
      leaderTaskId: childRow.leader_task_id
    };
  });

  if (result.resumed && result.leaderTaskId) {
    await enqueueWorkflowTaskRun({
      taskId: result.leaderTaskId,
      workspaceId: input.context.workspaceId,
      environmentId: input.context.environmentId,
      triggerSource: "web",
      mode: "agent_swarm_leader",
      selectionUserId: undefined,
      toolOptionsOverride: getSwarmToolOptionsOverride(input.context)
    });
  }
  return result;
}

export async function cancelSwarmNode(input: {
  context: LoadedWorkflowRunContext;
  targetSwarm?: SwarmTarget;
  nodeId: string;
  reason: string;
}): Promise<{ nodeId: string; cancelledNodeIds: string[] }> {
  const parentTarget = assertLeader(input.context, input.targetSwarm);
  if (!parentTarget.nodeId) throw new Error("Node cancellation requires a budgeted Swarm root.");
  const cancelledNodeIds = await withTransaction(async (client) => {
    const parent = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM task_workflow_swarm_nodes
        WHERE workflow_task_id = $1 AND node_key = $2 FOR UPDATE`,
      [input.context.workflowTaskId, parentTarget.nodeId]
    );
    if (!parent.rows[0] || parent.rows[0].status !== "active") throw new Error("Parent Swarm node is not active.");
    const child = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM task_workflow_swarm_nodes
        WHERE workflow_task_id = $1 AND id = $2 AND parent_node_id = $3 FOR UPDATE`,
      [input.context.workflowTaskId, input.nodeId, parent.rows[0].id]
    );
    if (!child.rows[0]) throw new Error("Only a direct child node can be cancelled.");
    if (child.rows[0].status === "cancelled") throw new Error("Swarm child node is already cancelled.");
    const descendants = await client.query<{ id: string }>(
      `WITH RECURSIVE descendants AS (
        SELECT id FROM task_workflow_swarm_nodes WHERE id = $1
        UNION ALL
        SELECT child.id FROM task_workflow_swarm_nodes child JOIN descendants parent ON child.parent_node_id = parent.id
      ) SELECT id FROM descendants`,
      [input.nodeId]
    );
    const ids = descendants.rows.map((row) => row.id);
    await reclaimCancelledSwarmBudgetInTx(client, {
      workflowTaskId: input.context.workflowTaskId,
      parentNodeId: parent.rows[0].id,
      cancelledNodeIds: ids
    });
    await client.query(
      `UPDATE task_workflow_swarm_nodes
          SET status = 'cancelled', cancelled_at = now(), cancellation_reason = $2,
              paused_reason = 'parent_cancelled', updated_at = now()
        WHERE id = ANY($1::uuid[])`,
      [ids, input.reason.trim()]
    );
    const tasks = await client.query<{ task_id: string }>(
      `SELECT DISTINCT a.task_id
         FROM task_workflow_swarm_node_members m
         JOIN task_workflow_agents a ON a.id = m.workflow_agent_id
        WHERE m.node_id = ANY($1::uuid[])`,
      [ids]
    );
    const taskIds = tasks.rows.map((row) => row.task_id);
    if (taskIds.length > 0) {
      await client.query(
        `UPDATE tasks
            SET cancellation_requested = true, status = 'cancelled', completed_at = COALESCE(completed_at, now()), updated_at = now()
          WHERE id = ANY($1::uuid[])`,
        [taskIds]
      );
      await client.query(
        `UPDATE task_runs SET ended_at = COALESCE(ended_at, now()), exit_reason = 'cancelled'
          WHERE task_id = ANY($1::uuid[]) AND ended_at IS NULL`,
        [taskIds]
      );
    }

    const workflow = await client.query<{ config_json: Record<string, unknown> | null }>(
      `SELECT config_json FROM task_workflows WHERE task_id = $1 FOR UPDATE`,
      [input.context.workflowTaskId]
    );
    const config = asObject(workflow.rows[0]?.config_json);
    const compiled = readCompiledSwarm({ ...input.context, config });
    const cancelledKeys = new Set(
      (await client.query<{ node_key: string }>(
        `SELECT node_key FROM task_workflow_swarm_nodes WHERE id = ANY($1::uuid[])`,
        [ids]
      )).rows.map((row) => row.node_key)
    );
    compiled.nodes = compiled.nodes.filter((node) => typeof node.id !== "string" || !cancelledKeys.has(node.id));
    compiled.leaves = compiled.leaves.filter((leaf) => {
      const nodeIds = Array.isArray(leaf.nodeIds) ? leaf.nodeIds.filter((value): value is string => typeof value === "string") : [];
      return !nodeIds.some((nodeId) => cancelledKeys.has(nodeId));
    });
    for (const node of compiled.nodes) {
      if (typeof node.parentNodeId === "string" && cancelledKeys.has(node.parentNodeId)) {
        node.parentNodeId = null;
      }
      if (typeof node.leaderLeafId === "string" && !compiled.leaves.some((leaf) => leaf.id === node.leaderLeafId)) {
        delete node.leaderLeafId;
      }
      if (Array.isArray(node.workerLeafIds)) {
        node.workerLeafIds = node.workerLeafIds.filter((leafId): leafId is string =>
          typeof leafId === "string" && compiled.leaves.some((leaf) => leaf.id === leafId)
        );
      }
    }
    const swarmChannelIds = asObject(config.swarmChannelIds);
    for (const key of cancelledKeys) delete swarmChannelIds[key];
    await client.query(
      `UPDATE task_workflows
          SET config_json = $2::jsonb, updated_at = now()
        WHERE task_id = $1`,
      [input.context.workflowTaskId, JSON.stringify({
        ...config,
        compiledSwarm: { rootNodeId: compiled.rootNodeId, nodes: compiled.nodes, leaves: compiled.leaves },
        swarmChannelIds
      })]
    );
    return ids;
  });

  const tasks = await query<{ task_id: string; run_id: string }>(
    `SELECT tr.task_id, tr.id AS run_id
       FROM task_runs tr
      WHERE tr.task_id IN (
        SELECT a.task_id
          FROM task_workflow_swarm_node_members m
          JOIN task_workflow_agents a ON a.id = m.workflow_agent_id
         WHERE m.node_id = ANY($1::uuid[])
      )`,
    [cancelledNodeIds]
  );
  for (const task of tasks.rows) {
    const job = await taskQueue.getJob(buildTaskRunQueueJobId(task.task_id, task.run_id));
    if (job) await job.remove().catch(() => undefined);
  }
  return { nodeId: input.nodeId, cancelledNodeIds };
}
