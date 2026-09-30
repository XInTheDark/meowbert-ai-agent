import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  clampAgentSwarmWorkerCount,
  calculateAgentSwarmBudgetEstimate,
  calculateAgentSwarmInitialLeases,
  calculateAgentSwarmSystemReserve,
  AGENT_SWARM_MINIMUM_INFERENCE_TOKENS,
  AGENT_SWARM_DEFAULT_TOKEN_BUDGET,
  createTaskMessageMetadata,
  limitAgentSwarmAgentAllocations,
  type CompiledAgentSwarm,
  type PlatformAgentPreset,
  type TaskWorkflowType
} from "@meowbert/shared";
import type { z } from "zod";
import type { taskWorkflowPatchSchema } from "../../routes/tasks/shared.js";
import { deleteTaskTreesInTx, type TaskCleanupCandidateResult } from "./task-cleanup.js";
import { insertSeededSwarmQuotaNodesInTx } from "./agent-swarm-seeded-quota.js";

type TaskWorkflowPatchInput = NonNullable<z.infer<typeof taskWorkflowPatchSchema>>;

interface LockedTaskContext {
  id: string;
  workspace_id: string;
  environment_id: string;
  default_timezone: string;
  allow_waiting: boolean;
  workflow_type: TaskWorkflowType | null;
  title?: string | null;
}

const LONG_HORIZON_REVIEWER_COUNT = 1;

export class TaskTypeTransitionConflictError extends Error {
  readonly statusCode = 409;

  constructor() {
    super("Stop the task before changing its type.");
    this.name = "TaskTypeTransitionConflictError";
  }
}

function buildTaskRootPath(taskId: string): string {
  return `.meowbert/task-runs/${taskId}`;
}

function emptyTaskCleanupCandidates(): TaskCleanupCandidateResult {
  return { taskIds: [], taskRootPaths: [], workspacePaths: [], archiveKeys: [] };
}

function asPositiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

async function ensureAgentSwarmQuotaRootInTx(input: {
  client: PoolClient;
  taskId: string;
  nodeKey: string;
  title: string;
  tokenBudget: number | null;
  timeBudgetMinutes: number | null;
  leaderAgentId: string;
  workerAgentIds: string[];
  delegatedLeaderAgentIds?: Set<string>;
}): Promise<string | null> {
  const tokenBudget = asPositiveInteger(input.tokenBudget);
  if (tokenBudget === null) {
    const existing = await input.client.query<{ id: string }>(
      `SELECT id FROM task_workflow_swarm_nodes
        WHERE workflow_task_id = $1 AND node_key = $2
        FOR UPDATE`,
      [input.taskId, input.nodeKey]
    );
    if (existing.rows[0]) {
      throw new Error("An Agent Swarm token budget cannot be cleared after quota creation. Start a new swarm without a hard budget.");
    }
    return null;
  }

  const estimate = calculateAgentSwarmBudgetEstimate({
    minimumStepTokens: AGENT_SWARM_MINIMUM_INFERENCE_TOKENS,
    workerSlots: input.workerAgentIds.length
  });
  const reserveTokens = calculateAgentSwarmSystemReserve(tokenBudget, estimate.minimumStepTokens);
  if (tokenBudget < reserveTokens + estimate.minimumSpawnAllocationTokens) {
    throw new Error(`Agent Swarm token budget is too small. Minimum required for the initial roster is ${reserveTokens + estimate.minimumSpawnAllocationTokens} weighted tokens.`);
  }
  const deadlineAt = input.timeBudgetMinutes
    ? new Date(Date.now() + input.timeBudgetMinutes * 60_000).toISOString()
    : null;

  const existingResult = await input.client.query<{
    id: string;
    allocated_tokens: string | number;
    spent_tokens: string | number;
    reserved_tokens: string | number;
    debt_tokens: string | number;
  }>(
    `SELECT id, allocated_tokens, spent_tokens, reserved_tokens, debt_tokens
       FROM task_workflow_swarm_nodes
      WHERE workflow_task_id = $1 AND node_key = $2
      FOR UPDATE`,
    [input.taskId, input.nodeKey]
  );
  const existing = existingResult.rows[0];
  if (existing) {
    const existingAllocated = Math.max(0, Math.floor(Number(existing.allocated_tokens) || 0));
    if (existingAllocated !== tokenBudget) {
      throw new Error("Changing an Agent Swarm token budget after quota creation is not supported. Start a new swarm with the revised budget.");
    }
    await input.client.query(
      `UPDATE task_workflow_swarm_nodes
          SET deadline_at = $2,
              status = CASE WHEN paused_reason = 'deadline_reached' THEN 'active' ELSE status END,
              paused_reason = CASE WHEN paused_reason = 'deadline_reached' THEN NULL ELSE paused_reason END,
              updated_at = now()
        WHERE id = $1`,
      [existing.id, deadlineAt]
    );
    return existing.id;
  }
  const operatingTokens = Math.max(0, tokenBudget - reserveTokens);
  const { leaderLeaseTokens, workerLeaseTokens, unassignedTokens } = calculateAgentSwarmInitialLeases({
    operatingTokens,
    workerCount: input.workerAgentIds.filter((id) => !input.delegatedLeaderAgentIds?.has(id)).length,
    minimumStepTokens: AGENT_SWARM_MINIMUM_INFERENCE_TOKENS
  });

  const nodeResult = await input.client.query<{ id: string }>(
    `INSERT INTO task_workflow_swarm_nodes (
        workflow_task_id, node_key, generation, title, depth, status,
        leader_task_id, allocated_tokens, system_reserve_tokens,
        unassigned_tokens, deadline_at, created_by_workflow_agent_id
      ) VALUES ($1, $2, 0, $3, 1, 'active', $1, $4, $5, $6, $7, $8)
      RETURNING id`,
    [input.taskId, input.nodeKey, input.title, tokenBudget, reserveTokens, unassignedTokens, deadlineAt, input.leaderAgentId]
  );
  const nodeId = nodeResult.rows[0]?.id;
  if (!nodeId) throw new Error("Agent Swarm quota root could not be created.");
  await input.client.query(
    `INSERT INTO task_workflow_swarm_node_members
        (node_id, workflow_agent_id, role, slot_index, lease_tokens)
       VALUES ($1, $2, 'leader', 0, $3)`,
    [nodeId, input.leaderAgentId, leaderLeaseTokens]
  );
  for (let index = 0; index < input.workerAgentIds.length; index += 1) {
    await input.client.query(
      `INSERT INTO task_workflow_swarm_node_members
          (node_id, workflow_agent_id, role, slot_index, lease_tokens)
         VALUES ($1, $2, 'worker', $3, $4)`,
      [nodeId, input.workerAgentIds[index], index,
        input.delegatedLeaderAgentIds?.has(input.workerAgentIds[index]) ? 0 : workerLeaseTokens]
    );
  }
  await input.client.query(
    `INSERT INTO task_workflow_swarm_quota_ledger
        (workflow_task_id, node_id, kind, amount_tokens, metadata_json)
       VALUES ($1, $2, 'root_grant', $3, $4::jsonb)`,
    [input.taskId, nodeId, tokenBudget, JSON.stringify({ deadlineAt })]
  );
  return nodeId;
}

export async function assertTaskTypeTransitionIdleInTx(client: PoolClient, taskId: string): Promise<void> {
  const activeRes = await client.query<{ id: string }>(
    `WITH RECURSIVE task_scope AS (
       SELECT id
         FROM tasks
        WHERE id = $1
       UNION
       SELECT child.id
         FROM tasks child
         JOIN task_scope parent
           ON child.parent_task_id = parent.id
           OR child.workflow_parent_task_id = parent.id
      )
      SELECT id
        FROM tasks
       WHERE id IN (SELECT id FROM task_scope)
         AND status IN ('starting', 'running')
      UNION ALL
      SELECT tr.task_id AS id
        FROM task_runs tr
       WHERE tr.task_id IN (SELECT id FROM task_scope)
         AND tr.ended_at IS NULL
      LIMIT 1`,
    [taskId]
  );

  if ((activeRes.rowCount ?? 0) > 0) {
    throw new TaskTypeTransitionConflictError();
  }
}

export async function clearTaskWorkflowInTx(
  client: PoolClient,
  taskId: string
): Promise<TaskCleanupCandidateResult> {
  const childRes = await client.query<{ id: string }>(
    `SELECT id
       FROM tasks
      WHERE workflow_parent_task_id = $1
      FOR UPDATE`,
    [taskId]
  );

  await client.query(
    `UPDATE tasks
        SET status = 'cancelled',
            cancellation_requested = true,
            resume_after_interrupt = false,
            completed_at = COALESCE(completed_at, now()),
            updated_at = now()
      WHERE workflow_parent_task_id = $1
        AND status IN ('queued', 'starting', 'running', 'awaiting_input')`,
    [taskId]
  );

  const deletedChildren = await deleteTaskTreesInTx(client, childRes.rows.map((row) => row.id));
  await client.query(`DELETE FROM task_workflows WHERE task_id = $1`, [taskId]);

  await client.query(
    `UPDATE tasks
        SET workflow_type = NULL,
            workflow_internal_role = NULL,
            updated_at = now()
      WHERE id = $1`,
    [taskId]
  );

  return deletedChildren;
}

async function loadTaskInitialUserPrompt(client: PoolClient, taskId: string, fallbackTitle?: string | null): Promise<string> {
  const messageRes = await client.query<{ content_json: { text?: string } }>(
    `SELECT content_json
       FROM task_messages
      WHERE task_id = $1
        AND role = 'user'
      ORDER BY created_at ASC
      LIMIT 1`,
    [taskId]
  );

  return messageRes.rows[0]?.content_json?.text?.trim()
    || fallbackTitle?.trim()
    || "Execute the assigned task workflow.";
}

async function insertWorkflowRow(
  client: PoolClient,
  input: {
    taskId: string;
    workflowType: TaskWorkflowType;
    phase: string;
    config: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO task_workflows (task_id, workflow_type, phase, config_json, state_json)
     VALUES ($1, $2, $3, $4::jsonb, '{}'::jsonb)`,
    [input.taskId, input.workflowType, input.phase, JSON.stringify(input.config)]
  );
}

async function insertWorkflowAgent(
  client: PoolClient,
  input: {
    workflowTaskId: string;
    role: "main" | "reviewer" | "leader" | "worker";
    slotIndex: number;
    taskId: string;
    state?: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO task_workflow_agents (workflow_task_id, role, slot_index, task_id, state_json)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id`,
    [input.workflowTaskId, input.role, input.slotIndex, input.taskId, JSON.stringify(input.state ?? {})]
  );

  return { id: result.rows[0].id };
}

async function insertSystemChildTask(
  client: PoolClient,
  input: {
    taskId: string;
    parentTaskId: string;
    workspaceId: string;
    environmentId: string;
    initiatorUserId: string;
    title: string;
    message: string;
    defaultTimezone: string;
    allowWaiting: boolean;
    workflowType: TaskWorkflowType;
    workflowInternalRole: "worker" | "reviewer";
  }
): Promise<void> {
  const createdAt = new Date().toISOString();
  await client.query(
    `INSERT INTO tasks (
      id, workspace_id, environment_id, title, status, source,
      initiator_user_id, default_timezone, allow_waiting,
      task_root_path, workflow_type, workflow_parent_task_id, workflow_internal_role
    ) VALUES ($1, $2, $3, $4, 'queued', 'web', $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.taskId,
      input.workspaceId,
      input.environmentId,
      input.title,
      input.initiatorUserId,
      input.defaultTimezone,
      input.allowWaiting,
      buildTaskRootPath(input.taskId),
      input.workflowType,
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

function buildLongHorizonReviewerBootstrapMessage(userMessage: string): string {
  return [
    "You are the independent reviewer for this Long Horizon task.",
    "The primary agent is executing the following task:",
    "",
    userMessage.trim(),
    "",
    "Review their plan and submissions when requested using the review tools."
  ].join("\n");
}

function buildSwarmWorkerBootstrapMessage(workerNumber: number, userMessage: string): string {
  return [
    `You are Worker ${workerNumber} in this Agent Swarm.`,
    "Do not expect a direct user message in this worker thread.",
    "The swarm task is:",
    "",
    userMessage.trim(),
    "",
    "Start by reading the workflow/system instructions, then use the swarm tools to discuss with the team.",
    "Refresh your inbox before sending any swarm message."
  ].join("\n");
}

async function transitionToLongHorizonInTx(
  client: PoolClient,
  task: LockedTaskContext,
  userId: string,
  workflow: TaskWorkflowPatchInput
): Promise<TaskCleanupCandidateResult> {
  const enableClarifyPhase = workflow.enableClarifyPhase !== false;
  const enableReviewPhase = workflow.enableReviewPhase !== false;
  const reviewerCount = enableReviewPhase ? LONG_HORIZON_REVIEWER_COUNT : 0;
  const config = {
    reviewerCount,
    tokenBudget: workflow.tokenBudget ?? null,
    timeBudgetMinutes: workflow.timeBudgetMinutes ?? null,
    enableClarifyPhase,
    enableReviewPhase,
    reviewMode: workflow.type === "quality_control" ? "quality_control" : "standard",
    researchMode: workflow.type === "deep_research" ? "deep_research" : "standard"
  };

  if (task.workflow_type === "long_horizon") {
    const cleanup = await reconcileLongHorizonReviewersInTx(client, {
      task,
      userId,
      desiredReviewerCount: reviewerCount
    });
    await client.query(
      `UPDATE task_workflows
          SET config_json = config_json || $2::jsonb,
              updated_at = now()
        WHERE task_id = $1`,
      [task.id, JSON.stringify(config)]
    );
    return cleanup;
  }

  const cleanup = await clearTaskWorkflowInTx(client, task.id);
  await client.query(
    `UPDATE tasks
        SET workflow_type = 'long_horizon',
            workflow_internal_role = NULL,
            updated_at = now()
      WHERE id = $1`,
    [task.id]
  );

  await insertWorkflowRow(client, {
    taskId: task.id,
    workflowType: "long_horizon",
    phase: enableClarifyPhase ? "clarify" : "working",
    config
  });

  await insertWorkflowAgent(client, {
    workflowTaskId: task.id,
    role: "main",
    slotIndex: 0,
    taskId: task.id
  });

  const prompt = await loadTaskInitialUserPrompt(client, task.id, task.title);
  await addLongHorizonReviewersInTx(client, {
    task,
    userId,
    prompt,
    reviewerSlots: Array.from({ length: reviewerCount }, (_, index) => index)
  });

  return cleanup;
}

interface ExistingLongHorizonReviewer {
  agentId: string;
  taskId: string;
  slotIndex: number;
}

async function loadExistingLongHorizonReviewers(
  client: PoolClient,
  workflowTaskId: string
): Promise<ExistingLongHorizonReviewer[]> {
  const reviewersRes = await client.query<ExistingLongHorizonReviewer>(
    `SELECT a.id AS "agentId",
            a.task_id AS "taskId",
            a.slot_index AS "slotIndex"
       FROM task_workflow_agents a
      WHERE a.workflow_task_id = $1
        AND a.role = 'reviewer'
      ORDER BY a.slot_index ASC, a.task_id ASC
      FOR UPDATE`,
    [workflowTaskId]
  );

  return reviewersRes.rows;
}

async function addLongHorizonReviewersInTx(
  client: PoolClient,
  input: {
    task: LockedTaskContext;
    userId: string;
    prompt: string;
    reviewerSlots: number[];
  }
): Promise<void> {
  for (const index of input.reviewerSlots) {
    const reviewerTaskId = randomUUID();
    await insertSystemChildTask(client, {
      taskId: reviewerTaskId,
      parentTaskId: input.task.id,
      workspaceId: input.task.workspace_id,
      environmentId: input.task.environment_id,
      initiatorUserId: input.userId,
      title: `${input.task.title?.trim() || "Long Horizon Task"} · Reviewer ${index + 1}`,
      message: buildLongHorizonReviewerBootstrapMessage(input.prompt),
      defaultTimezone: input.task.default_timezone,
      allowWaiting: false,
      workflowType: "long_horizon",
      workflowInternalRole: "reviewer"
    });

    await insertWorkflowAgent(client, {
      workflowTaskId: input.task.id,
      role: "reviewer",
      slotIndex: index,
      taskId: reviewerTaskId
    });
  }
}

async function cancelTaskRowsInTx(client: PoolClient, taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) {
    return;
  }

  await client.query(
    `UPDATE tasks
        SET status = CASE
              WHEN status IN ('queued', 'starting', 'running', 'awaiting_input') THEN 'cancelled'
              ELSE status
            END,
            cancellation_requested = CASE
              WHEN status IN ('queued', 'starting', 'running', 'awaiting_input') THEN true
              ELSE cancellation_requested
            END,
            resume_after_interrupt = CASE
              WHEN status IN ('queued', 'starting', 'running', 'awaiting_input') THEN false
              ELSE resume_after_interrupt
            END,
            completed_at = CASE
              WHEN status IN ('queued', 'starting', 'running', 'awaiting_input') THEN COALESCE(completed_at, now())
              ELSE completed_at
            END,
            updated_at = now()
      WHERE id = ANY($1::uuid[])`,
    [taskIds]
  );
}

async function reconcileLongHorizonReviewersInTx(
  client: PoolClient,
  input: {
    task: LockedTaskContext;
    userId: string;
    desiredReviewerCount: number;
  }
): Promise<TaskCleanupCandidateResult> {
  const existingReviewers = await loadExistingLongHorizonReviewers(client, input.task.id);
  const reviewersToRemove = existingReviewers.slice(input.desiredReviewerCount);
  await cancelTaskRowsInTx(client, reviewersToRemove.map((reviewer) => reviewer.taskId));
  const cleanup = await deleteTaskTreesInTx(client, reviewersToRemove.map((reviewer) => reviewer.taskId));
  const retainedReviewers = existingReviewers.slice(0, input.desiredReviewerCount);
  const retainedSlots = new Set(retainedReviewers.map((reviewer) => reviewer.slotIndex));

  for (const [index, reviewer] of retainedReviewers.entries()) {
    if (reviewer.slotIndex === index) {
      continue;
    }
    await client.query(
      `UPDATE task_workflow_agents
          SET slot_index = $2,
              updated_at = now()
        WHERE id = $1`,
      [reviewer.agentId, index]
    );
    retainedSlots.delete(reviewer.slotIndex);
    retainedSlots.add(index);
  }

  const missingReviewerCount = input.desiredReviewerCount - retainedReviewers.length;
  if (missingReviewerCount <= 0) {
    return cleanup;
  }

  const prompt = await loadTaskInitialUserPrompt(client, input.task.id, input.task.title);
  const missingSlots = Array.from({ length: input.desiredReviewerCount }, (_, index) => index)
    .filter((index) => !retainedSlots.has(index));
  await addLongHorizonReviewersInTx(client, {
    task: input.task,
    userId: input.userId,
    prompt,
    reviewerSlots: missingSlots
  });

  return cleanup;
}

interface ExistingSwarmWorker {
  agentId: string;
  taskId: string;
  slotIndex: number;
  status: string;
}

async function loadExistingSwarmWorkers(client: PoolClient, workflowTaskId: string): Promise<ExistingSwarmWorker[]> {
  const workersRes = await client.query<ExistingSwarmWorker>(
    `SELECT a.id AS "agentId",
            a.task_id AS "taskId",
            a.slot_index AS "slotIndex",
            t.status
       FROM task_workflow_agents a
       JOIN tasks t ON t.id = a.task_id
      WHERE a.workflow_task_id = $1
        AND a.role = 'worker'
      ORDER BY a.slot_index ASC, a.task_id ASC
      FOR UPDATE OF a, t`,
    [workflowTaskId]
  );

  return workersRes.rows;
}

async function removeSwarmWorkers(
  client: PoolClient,
  workers: ExistingSwarmWorker[]
): Promise<TaskCleanupCandidateResult> {
  if (workers.length === 0) return emptyTaskCleanupCandidates();

  const taskIds = workers.map((worker) => worker.taskId);
  await cancelTaskRowsInTx(client, taskIds);

  return deleteTaskTreesInTx(client, taskIds);
}

async function addSwarmWorkers(
  client: PoolClient,
  input: {
    task: LockedTaskContext;
    userId: string;
    existingWorkerCount: number;
    desiredWorkerCount: number;
  }
): Promise<void> {
  if (input.desiredWorkerCount <= input.existingWorkerCount) return;

  const prompt = await loadTaskInitialUserPrompt(client, input.task.id, input.task.title);
  const globalChannelsRes = await client.query<{ id: string }>(
    `SELECT id
       FROM task_workflow_channels
      WHERE workflow_task_id = $1
        AND kind = 'global'
      ORDER BY created_at ASC, id ASC`,
    [input.task.id]
  );

  for (let index = input.existingWorkerCount; index < input.desiredWorkerCount; index += 1) {
    const workerTaskId = randomUUID();
    await insertSystemChildTask(client, {
      taskId: workerTaskId,
      parentTaskId: input.task.id,
      workspaceId: input.task.workspace_id,
      environmentId: input.task.environment_id,
      initiatorUserId: input.userId,
      title: `${input.task.title?.trim() || "Agent Swarm Task"} · Worker ${index + 1}`,
      message: buildSwarmWorkerBootstrapMessage(index + 1, prompt),
      defaultTimezone: input.task.default_timezone,
      allowWaiting: input.task.allow_waiting,
      workflowType: "agent_swarm",
      workflowInternalRole: "worker"
    });

    const workerAgent = await insertWorkflowAgent(client, {
      workflowTaskId: input.task.id,
      role: "worker",
      slotIndex: index,
      taskId: workerTaskId
    });

    for (const channel of globalChannelsRes.rows) {
      await client.query(
        `INSERT INTO task_workflow_channel_members (channel_id, workflow_agent_id)
         VALUES ($1, $2)`,
        [channel.id, workerAgent.id]
      );
    }
  }
}

async function reconcileAgentSwarmWorkers(
  client: PoolClient,
  input: {
    task: LockedTaskContext;
    userId: string;
    desiredWorkerCount: number;
  }
): Promise<TaskCleanupCandidateResult> {
  const existingWorkers = await loadExistingSwarmWorkers(client, input.task.id);
  const cleanup = await removeSwarmWorkers(client, existingWorkers.slice(input.desiredWorkerCount));
  await addSwarmWorkers(client, {
    task: input.task,
    userId: input.userId,
    existingWorkerCount: Math.min(existingWorkers.length, input.desiredWorkerCount),
    desiredWorkerCount: input.desiredWorkerCount
  });
  return cleanup;
}

function compiledLeafState(leaf: CompiledAgentSwarm["leaves"][number] | null): Record<string, unknown> {
  return leaf ? {
    ...(leaf.agentId ? { agentPresetId: leaf.agentId } : {}),
    swarmLeafId: leaf.id,
    agentPresetMode: leaf.mode,
    swarmNodeIds: leaf.nodeIds,
    swarmLeaderNodeIds: leaf.leaderNodeIds,
    swarmParentNodeId: leaf.parentNodeId
  } : {};
}

function buildFlatSwarmTopology(input: {
  title: string;
  workerCount: number;
  reviewRounds: number;
}): CompiledAgentSwarm {
  const rootNodeId = "node-0";
  const workerLeafIds = Array.from({ length: input.workerCount }, (_, index) => `leaf-${index + 1}`);
  return {
    rootNodeId,
    nodes: [{ id: rootNodeId, parentNodeId: null, title: input.title,
      leaderLeafId: "leaf-0", workerLeafIds, reviewRounds: input.reviewRounds }],
    leaves: [
      { id: "leaf-0", agentId: "", name: "Leader", mode: "standard",
        nodeIds: [rootNodeId], leaderNodeIds: [rootNodeId], parentNodeId: null },
      ...workerLeafIds.map((id, index) => ({ id, agentId: "",
        name: `Worker ${index + 1}`, mode: "standard" as const,
        nodeIds: [rootNodeId], leaderNodeIds: [], parentNodeId: rootNodeId }))
    ]
  };
}

async function createCompiledSwarmChannels(
  client: PoolClient,
  taskId: string,
  compiledSwarm: CompiledAgentSwarm,
  agentIdsByLeaf: Map<string, string>
): Promise<Record<string, string>> {
  const swarmChannelIds: Record<string, string> = {};
  for (const node of compiledSwarm.nodes) {
    const channel = await client.query<{ id: string }>(
      `INSERT INTO task_workflow_channels (workflow_task_id, kind, title, created_by_workflow_agent_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [
        taskId,
        node.id === compiledSwarm.rootNodeId ? "global" : "group",
        node.id === compiledSwarm.rootNodeId ? "Global" : node.title,
        agentIdsByLeaf.get(node.leaderLeafId) ?? null
      ]
    );
    const channelId = channel.rows[0].id;
    swarmChannelIds[node.id] = channelId;
    for (const leafId of [node.leaderLeafId, ...node.workerLeafIds]) {
      const agentId = agentIdsByLeaf.get(leafId);
      if (agentId) {
        await client.query(
          `INSERT INTO task_workflow_channel_members (channel_id, workflow_agent_id) VALUES ($1, $2)`,
          [channelId, agentId]
        );
      }
    }
  }
  return swarmChannelIds;
}

async function createAgentSwarmTransitionInTx(
  client: PoolClient,
  input: {
    task: LockedTaskContext;
    userId: string;
    config: Record<string, unknown>;
    workerCount: number;
    compiledSwarm?: CompiledAgentSwarm;
    promptOverride?: string;
  }
): Promise<TaskCleanupCandidateResult> {
  const { task, userId, workerCount, compiledSwarm, promptOverride } = input;
  const cleanup = await clearTaskWorkflowInTx(client, task.id);
  await client.query(
    `UPDATE tasks
        SET workflow_type = 'agent_swarm',
            workflow_internal_role = 'leader',
            updated_at = now()
      WHERE id = $1`,
    [task.id]
  );

  await insertWorkflowRow(client, {
    taskId: task.id,
    workflowType: "agent_swarm",
    phase: "active",
    config: input.config
  });

  const rootNode = compiledSwarm?.nodes.find((node) => node.id === compiledSwarm.rootNodeId) ?? null;
  const leaderLeaf = rootNode
    ? compiledSwarm!.leaves.find((leaf) => leaf.id === rootNode.leaderLeafId) ?? null
    : null;
  const workerLeaves = compiledSwarm && rootNode
    ? compiledSwarm.leaves.filter((leaf) => leaf.id !== rootNode.leaderLeafId)
    : [];
  const agentIdsByLeaf = new Map<string, string>();
  const leaderAgent = await insertWorkflowAgent(client, {
    workflowTaskId: task.id,
    role: "leader",
    slotIndex: 0,
    taskId: task.id,
    state: compiledLeafState(leaderLeaf)
  });
  if (leaderLeaf) agentIdsByLeaf.set(leaderLeaf.id, leaderAgent.id);

  const prompt = promptOverride ?? await loadTaskInitialUserPrompt(client, task.id, task.title);
  const workerAgentIds: string[] = [];

  for (let index = 0; index < workerCount; index += 1) {
    const workerTaskId = randomUUID();
    const leaf = workerLeaves[index] ?? null;
    await insertSystemChildTask(client, {
      taskId: workerTaskId,
      parentTaskId: task.id,
      workspaceId: task.workspace_id,
      environmentId: task.environment_id,
      initiatorUserId: userId,
      title: `${task.title?.trim() || "Agent Swarm Task"} · ${leaf?.name ?? `Worker ${index + 1}`}`,
      message: buildSwarmWorkerBootstrapMessage(index + 1, prompt),
      defaultTimezone: task.default_timezone,
      allowWaiting: task.allow_waiting,
      workflowType: "agent_swarm",
      workflowInternalRole: "worker"
    });

    const workerAgent = await insertWorkflowAgent(client, {
      workflowTaskId: task.id,
      role: "worker",
      slotIndex: index,
      taskId: workerTaskId,
      state: compiledLeafState(leaf)
    });
    workerAgentIds.push(workerAgent.id);
    if (leaf) agentIdsByLeaf.set(leaf.id, workerAgent.id);
  }

  const directWorkerAgentIds = rootNode
    ? rootNode.workerLeafIds.map((leafId) => agentIdsByLeaf.get(leafId)).filter((id): id is string => Boolean(id))
    : workerAgentIds;
  const quotaRootNodeId = await ensureAgentSwarmQuotaRootInTx({
    client,
    taskId: task.id,
    nodeKey: rootNode?.id ?? "node-0",
    title: task.title?.trim() || "Agent Swarm Task",
    tokenBudget: typeof input.config.tokenBudget === "number" ? input.config.tokenBudget : null,
    timeBudgetMinutes: typeof input.config.timeBudgetMinutes === "number" ? input.config.timeBudgetMinutes : null,
    leaderAgentId: leaderAgent.id,
    workerAgentIds: directWorkerAgentIds,
    delegatedLeaderAgentIds: new Set(compiledSwarm?.nodes
      .filter((node) => node.parentNodeId === rootNode?.id)
      .map((node) => agentIdsByLeaf.get(node.leaderLeafId))
      .filter((id): id is string => Boolean(id)) ?? [])
  });
  if (quotaRootNodeId && compiledSwarm && compiledSwarm.nodes.length > 1) {
    await insertSeededSwarmQuotaNodesInTx(client, {
      workflowTaskId: task.id,
      compiledSwarm,
      rootQuotaNodeId: quotaRootNodeId,
      agentIdsByLeaf
    });
  }

  if (compiledSwarm && rootNode) {
    const swarmChannelIds = await createCompiledSwarmChannels(client, task.id, compiledSwarm, agentIdsByLeaf);
    await client.query(
      `UPDATE task_workflows SET config_json = config_json || $2::jsonb, updated_at = now() WHERE task_id = $1`,
      [task.id, JSON.stringify({ swarmChannelIds })]
    );
    return cleanup;
  }

  const channelRes = await client.query<{ id: string }>(
    `INSERT INTO task_workflow_channels (workflow_task_id, kind, title, created_by_workflow_agent_id)
     VALUES ($1, 'global', 'Global', $2)
     RETURNING id`,
    [task.id, leaderAgent.id]
  );
  const channelId = channelRes.rows[0].id;

  for (const agentId of [leaderAgent.id, ...workerAgentIds]) {
    await client.query(
      `INSERT INTO task_workflow_channel_members (channel_id, workflow_agent_id)
       VALUES ($1, $2)`,
      [channelId, agentId]
    );
  }

  return cleanup;
}

async function transitionToAgentSwarmInTx(
  client: PoolClient,
  task: LockedTaskContext,
  userId: string,
  workflow: TaskWorkflowPatchInput,
  compiledSwarm?: CompiledAgentSwarm,
  promptOverride?: string,
  dynamicNodeTypes?: PlatformAgentPreset[]
): Promise<TaskCleanupCandidateResult> {
  const workerCount = compiledSwarm
    ? Math.max(0, compiledSwarm.leaves.length - 1)
    : clampAgentSwarmWorkerCount(workflow.workerCount);
  const agentAllocations = limitAgentSwarmAgentAllocations(workflow.modelAllocations ?? [], workerCount);
  if (!compiledSwarm && task.workflow_type !== "agent_swarm") {
    compiledSwarm = buildFlatSwarmTopology({
      title: task.title?.trim() || "Agent Swarm Task",
      workerCount,
      reviewRounds: workflow.reviewRounds ?? 0
    });
  }
  // Without budgets there is nothing to fund child nodes, so spawning goes with them.
  const budgetsDisabled = workflow.disableSpawningAndBudgets === true;
  const config = {
    workerCount,
    reviewRounds: workflow.reviewRounds ?? 0,
    modelAllocations: agentAllocations,
    leaderAgentId: workflow.leaderAgentId ?? null,
    tokenBudget: budgetsDisabled
      ? null
      : workflow.tokenBudget ?? (task.workflow_type === "agent_swarm" ? null : AGENT_SWARM_DEFAULT_TOKEN_BUDGET),
    timeBudgetMinutes: budgetsDisabled ? null : workflow.timeBudgetMinutes ?? null,
    ...(budgetsDisabled ? { dynamicNodeTypes: [] } : dynamicNodeTypes ? { dynamicNodeTypes } : {}),
    ...(compiledSwarm ? { compiledSwarm } : {})
  };

  let existingBudget: number | null = null;
  if (task.workflow_type === "agent_swarm") {
    const existingBudgetResult = await client.query<{ token_budget: number | null; compiled_swarm: CompiledAgentSwarm | null }>(
      `SELECT (config_json->>'tokenBudget')::bigint AS token_budget,
              config_json->'compiledSwarm' AS compiled_swarm
         FROM task_workflows
        WHERE task_id = $1
        FOR UPDATE`,
      [task.id]
    );
    existingBudget = asPositiveInteger(existingBudgetResult.rows[0]?.token_budget);
    const nextBudget = asPositiveInteger(config.tokenBudget);
    if (existingBudget !== null && existingBudget !== nextBudget) {
      throw new Error("Changing or clearing an Agent Swarm token budget after creation is not supported. Start a new swarm with the revised budget.");
    }
    if (existingBudget === null && nextBudget !== null && !compiledSwarm) {
      compiledSwarm = existingBudgetResult.rows[0]?.compiled_swarm ?? undefined;
    }
  }

  if (task.workflow_type === "agent_swarm") {
    const cleanup = await reconcileAgentSwarmWorkers(client, {
      task,
      userId,
      desiredWorkerCount: workerCount
    });
    const members = await client.query<{ id: string; role: "leader" | "worker"; state_json: Record<string, unknown> }>(
      `SELECT id, role, state_json
         FROM task_workflow_agents
        WHERE workflow_task_id = $1
        ORDER BY role ASC, slot_index ASC`,
      [task.id]
    );
    const leaderAgent = members.rows.find((member) => member.role === "leader");
    if (leaderAgent) {
      const agentIdsByLeaf = new Map(members.rows.flatMap((member) => {
        const leafId = member.state_json?.swarmLeafId;
        return typeof leafId === "string" ? [[leafId, member.id] as const] : [];
      }));
      const rootNode = compiledSwarm?.nodes.find((node) => node.id === compiledSwarm.rootNodeId);
      const directWorkerAgentIds = rootNode
        ? rootNode.workerLeafIds.map((leafId) => agentIdsByLeaf.get(leafId)).filter((id): id is string => Boolean(id))
        : members.rows.filter((member) => member.role === "worker").map((member) => member.id);
      const quotaRootNodeId = await ensureAgentSwarmQuotaRootInTx({
        client,
        taskId: task.id,
        nodeKey: rootNode?.id ?? "node-0",
        title: task.title?.trim() || "Agent Swarm Task",
        tokenBudget: typeof config.tokenBudget === "number" ? config.tokenBudget : null,
        timeBudgetMinutes: typeof config.timeBudgetMinutes === "number" ? config.timeBudgetMinutes : null,
        leaderAgentId: leaderAgent.id,
        workerAgentIds: directWorkerAgentIds,
        delegatedLeaderAgentIds: new Set(compiledSwarm?.nodes
          .filter((node) => node.parentNodeId === rootNode?.id)
          .map((node) => agentIdsByLeaf.get(node.leaderLeafId))
          .filter((id): id is string => Boolean(id)) ?? [])
      });
      if (quotaRootNodeId && compiledSwarm && compiledSwarm.nodes.length > 1 && existingBudget === null) {
        await insertSeededSwarmQuotaNodesInTx(client, {
          workflowTaskId: task.id,
          compiledSwarm,
          rootQuotaNodeId: quotaRootNodeId,
          agentIdsByLeaf
        });
      }
    }
    await client.query(
      `UPDATE task_workflows
          SET config_json = config_json || $2::jsonb,
              updated_at = now()
        WHERE task_id = $1`,
      [task.id, JSON.stringify(config)]
    );
    return cleanup;
  }

  return createAgentSwarmTransitionInTx(client, {
    task, userId, config, workerCount, compiledSwarm, promptOverride
  });
}

export async function applyWorkflowTransitionInTx(
  client: PoolClient,
  input: {
    taskId: string;
    userId: string;
    task: LockedTaskContext;
    workflow: TaskWorkflowPatchInput;
    compiledSwarm?: CompiledAgentSwarm;
    promptOverride?: string;
    dynamicNodeTypes?: PlatformAgentPreset[];
  }
): Promise<TaskCleanupCandidateResult> {
  if (input.workflow.type === "standard") {
    return clearTaskWorkflowInTx(client, input.taskId);
  }

  if (
    input.workflow.type === "long_horizon"
    || input.workflow.type === "deep_research"
    || input.workflow.type === "quality_control"
  ) {
    return transitionToLongHorizonInTx(client, input.task, input.userId, input.workflow);
  }

  if (input.workflow.type === "agent_swarm") {
    return transitionToAgentSwarmInTx(
      client, input.task, input.userId, input.workflow, input.compiledSwarm, input.promptOverride, input.dynamicNodeTypes
    );
  }

  return emptyTaskCleanupCandidates();
}
