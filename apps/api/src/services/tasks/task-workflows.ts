import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  clampAgentSwarmWorkerCount,
  calculateAgentSwarmBudgetEstimate,
  calculateAgentSwarmInitialLeases,
  calculateAgentSwarmSystemReserve,
  AGENT_SWARM_MINIMUM_INFERENCE_TOKENS,
  createTaskMessageMetadata,
  limitAgentSwarmAgentAllocations,
  type AgentSwarmAgentAllocation,
  type CompiledAgentSwarm,
  type PlatformAgentPreset,
  type TaskWorkflowType
} from "@meowbert/shared";
import { query, withTransaction } from "../../lib/db.js";
import {
  buildUserMessageContent,
  normalizeTaskMessageToolOptions,
  setTaskBranchSelection,
  type TaskMessageAttachment,
  type TaskMessageAgentSelection,
  type TaskMessageToolOptions
} from "./task-service/index.js";
import { ensureDispatchedRun } from "./task-service/runs.js";
import type { ProjectCanvasIntent } from "../canvases/project-canvases.js";
import { activateTaskTimeLimitInTx } from "./task-service/time-limit.js";
import { insertSeededSwarmQuotaNodesInTx } from "./agent-swarm-seeded-quota.js";

type WorkflowPhase =
  | "clarify"
  | "working"
  | "approved"
  | "completed"
  | "active";

interface BaseCreateWorkflowInput {
  taskId?: string;
  workspaceId: string;
  environmentId: string;
  initiatorUserId: string;
  title?: string;
  message: string;
  attachments?: TaskMessageAttachment[];
  defaultTimezone: string;
  tools?: TaskMessageToolOptions;
  agent?: TaskMessageAgentSelection;
  maxStepsOverride?: number | null;
  allowWaiting?: boolean | null;
  timeLimitSeconds?: number | null;
  interactiveCanvasId?: string | null;
  interactiveCanvasIntent?: ProjectCanvasIntent | null;
}

type LongHorizonWorkflowInput = BaseCreateWorkflowInput & {
  tokenBudget?: number | null;
  timeBudgetMinutes?: number | null;
  enableClarifyPhase?: boolean;
  enableReviewPhase?: boolean;
  reviewMode?: "standard" | "quality_control";
  researchMode?: "standard" | "deep_research";
};

type AgentSwarmWorkflowInput = BaseCreateWorkflowInput & {
  workerCount: number;
  reviewRounds: number;
  agentAllocations?: AgentSwarmAgentAllocation[];
  leaderAgentId?: string | null;
  compiledSwarm?: CompiledAgentSwarm;
  tokenBudget?: number | null;
  timeBudgetMinutes?: number | null;
  dynamicNodeTypes?: PlatformAgentPreset[];
};

const LONG_HORIZON_REVIEWER_COUNT = 1;

interface ExistingWorkflowTaskCreateMatch {
  taskId: string;
  userMessageId: string;
}

function buildTaskRootPath(taskId: string): string {
  return `.meowbert/task-runs/${taskId}`;
}

function isTaskPrimaryKeyConflict(error: unknown): boolean {
  return (error as { code?: string }).code === "23505"
    && (error as { constraint?: string }).constraint === "tasks_pkey";
}

async function findExistingWorkflowTask(
  taskId: string,
  input: BaseCreateWorkflowInput,
  workflowType: "long_horizon" | "agent_swarm"
): Promise<ExistingWorkflowTaskCreateMatch | null> {
  const existingRes = await query<{
    task_id: string;
    user_message_id: string | null;
  }>(
    `SELECT t.id AS task_id,
            initial_user.id AS user_message_id
       FROM tasks t
       JOIN task_workflows w
         ON w.task_id = t.id
        AND w.workflow_type = $5
       LEFT JOIN LATERAL (
         SELECT tm.id
           FROM task_messages tm
          WHERE tm.task_id = t.id
            AND tm.role = 'user'
          ORDER BY tm.created_at ASC, tm.id ASC
          LIMIT 1
       ) AS initial_user ON true
      WHERE t.id = $1
        AND t.workspace_id = $2
        AND t.environment_id = $3
        AND t.source = 'web'
        AND t.initiator_user_id = $4
      LIMIT 1`,
    [taskId, input.workspaceId, input.environmentId, input.initiatorUserId, workflowType]
  );
  const existing = existingRes.rows[0];
  if (!existing?.user_message_id) {
    return null;
  }

  return {
    taskId: existing.task_id,
    userMessageId: existing.user_message_id
  };
}

async function ensureWorkflowInitialRun(input: {
  taskId: string;
  userMessageId: string;
  workspaceId: string;
  environmentId: string;
  initiatorUserId: string;
  mode: "long_horizon_clarify" | "long_horizon_main" | "agent_swarm_leader";
  toolOptionsOverride?: TaskMessageToolOptions;
}): Promise<{ runId: string }> {
  const run = await ensureDispatchedRun({
    taskId: input.taskId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    triggerSource: "web",
    mode: input.mode,
    branchMessageId: input.userMessageId,
    selectionUserId: input.initiatorUserId,
    priorityActorUserId: input.initiatorUserId,
    dispatchCategory: "new",
    toolOptionsOverride: input.toolOptionsOverride
      ? normalizeTaskMessageToolOptions(input.toolOptionsOverride)
      : undefined
  });
  return { runId: run.runId };
}

async function reuseExistingWorkflowTask(input: {
  existing: ExistingWorkflowTaskCreateMatch;
  workspaceId: string;
  environmentId: string;
  initiatorUserId: string;
  mode: "long_horizon_clarify" | "long_horizon_main" | "agent_swarm_leader";
  toolOptionsOverride?: TaskMessageToolOptions;
}): Promise<{ taskId: string; runId: string; userMessageId: string; reusedExisting: true }> {
  const run = await ensureWorkflowInitialRun({
    taskId: input.existing.taskId,
    userMessageId: input.existing.userMessageId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    initiatorUserId: input.initiatorUserId,
    mode: input.mode,
    toolOptionsOverride: input.toolOptionsOverride
  });
  return {
    taskId: input.existing.taskId,
    runId: run.runId,
    userMessageId: input.existing.userMessageId,
    reusedExisting: true
  };
}

async function insertTaskWithInitialUserMessage(
  client: PoolClient,
  input: {
    taskId: string;
    workspaceId: string;
    environmentId: string;
    initiatorUserId: string;
    title?: string;
    message: string;
    attachments?: TaskMessageAttachment[];
    defaultTimezone: string;
    tools?: TaskMessageToolOptions;
    agent?: TaskMessageAgentSelection;
    maxStepsOverride?: number | null;
    allowWaiting?: boolean | null;
    timeLimitSeconds?: number | null;
    workflowType?: TaskWorkflowType | null;
    workflowParentTaskId?: string | null;
    workflowInternalRole?: "leader" | "worker" | "reviewer" | null;
    interactiveCanvasId?: string | null;
    interactiveCanvasIntent?: ProjectCanvasIntent | null;
  }
): Promise<{ userMessageId: string; userMessageCreatedAt: string }> {
  const createdAt = new Date().toISOString();
  await client.query(
    `INSERT INTO tasks (
      id,
      workspace_id,
      environment_id,
      title,
      status,
      source,
      initiator_user_id,
      default_timezone,
      max_steps_override,
      allow_waiting,
      time_limit_seconds,
      task_root_path,
      workflow_type,
      workflow_parent_task_id,
      workflow_internal_role,
      interactive_canvas_id,
      interactive_canvas_intent
    ) VALUES ($1, $2, $3, $4, 'queued', 'web', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      input.taskId,
      input.workspaceId,
      input.environmentId,
      input.title ?? null,
      input.initiatorUserId,
      input.defaultTimezone,
      input.maxStepsOverride ?? null,
      input.allowWaiting ?? true,
      input.timeLimitSeconds ?? null,
      buildTaskRootPath(input.taskId),
      input.workflowType ?? null,
      input.workflowParentTaskId ?? null,
      input.workflowInternalRole ?? null,
      input.interactiveCanvasId ?? null,
      input.interactiveCanvasIntent ?? null
    ]
  );

  const insertedUser = await client.query<{ id: string; created_at: string }>(
    `INSERT INTO task_messages (
      task_id,
      role,
      content_json,
      message_metadata_json,
      author_user_id,
      created_at
    )
    VALUES ($1, 'user', $2::jsonb, $3::jsonb, $4, $5)
    RETURNING id, created_at`,
    [
      input.taskId,
      JSON.stringify(
        buildUserMessageContent({
          message: input.message,
          attachments: input.attachments,
          tools: input.tools,
          agent: input.agent
        })
      ),
      JSON.stringify(createTaskMessageMetadata(createdAt)),
      input.initiatorUserId,
      createdAt
    ]
  );

  return {
    userMessageId: insertedUser.rows[0].id,
    userMessageCreatedAt: insertedUser.rows[0].created_at
  };
}

async function insertTaskWithInitialSystemMessage(
  client: PoolClient,
  input: {
    taskId: string;
    workspaceId: string;
    environmentId: string;
    initiatorUserId: string;
    title?: string;
    message: string;
    defaultTimezone: string;
    maxStepsOverride?: number | null;
    allowWaiting?: boolean | null;
    timeLimitSeconds?: number | null;
    workflowType?: TaskWorkflowType | null;
    workflowParentTaskId?: string | null;
    workflowInternalRole?: "leader" | "worker" | "reviewer" | null;
    interactiveCanvasId?: string | null;
    interactiveCanvasIntent?: ProjectCanvasIntent | null;
  }
): Promise<{ messageId: string }> {
  const createdAt = new Date().toISOString();
  await client.query(
    `INSERT INTO tasks (
      id,
      workspace_id,
      environment_id,
      title,
      status,
      source,
      initiator_user_id,
      default_timezone,
      max_steps_override,
      allow_waiting,
      time_limit_seconds,
      task_root_path,
      workflow_type,
      workflow_parent_task_id,
      workflow_internal_role,
      interactive_canvas_id,
      interactive_canvas_intent
    ) VALUES ($1, $2, $3, $4, 'queued', 'web', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      input.taskId,
      input.workspaceId,
      input.environmentId,
      input.title ?? null,
      input.initiatorUserId,
      input.defaultTimezone,
      input.maxStepsOverride ?? null,
      input.allowWaiting ?? true,
      input.timeLimitSeconds ?? null,
      buildTaskRootPath(input.taskId),
      input.workflowType ?? null,
      input.workflowParentTaskId ?? null,
      input.workflowInternalRole ?? null,
      input.interactiveCanvasId ?? null,
      input.interactiveCanvasIntent ?? null
    ]
  );

  const insertedSystem = await client.query<{ id: string }>(
    `INSERT INTO task_messages (
      task_id,
      role,
      content_json,
      message_metadata_json,
      created_at
    )
    VALUES ($1, 'system', $2::jsonb, $3::jsonb, $4)
    RETURNING id`,
    [
      input.taskId,
      JSON.stringify({
        text: input.message
      }),
      JSON.stringify(createTaskMessageMetadata(createdAt)),
      createdAt
    ]
  );

  return {
    messageId: insertedSystem.rows[0].id
  };
}

function buildSwarmWorkerBootstrapMessage(input: {
  workerNumber: number;
  userMessage: string;
}): string {
  return [
    `You are Worker ${input.workerNumber} in this Agent Swarm.`,
    "Do not expect a direct user message in this worker thread.",
    "The swarm task is:",
    "",
    input.userMessage.trim(),
    "",
    "Start by reading the workflow/system instructions, then use the swarm tools to discuss with the team.",
    "Refresh your inbox before sending any swarm message."
  ].join("\n");
}

async function insertWorkflowRow(
  client: PoolClient,
  input: {
    taskId: string;
    workflowType: TaskWorkflowType;
    phase: WorkflowPhase;
    config: Record<string, unknown>;
    state?: Record<string, unknown>;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO task_workflows (
      task_id,
      workflow_type,
      phase,
      config_json,
      state_json
    )
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
    [
      input.taskId,
      input.workflowType,
      input.phase,
      JSON.stringify(input.config),
      JSON.stringify(input.state ?? {})
    ]
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
    `INSERT INTO task_workflow_agents (
      workflow_task_id,
      role,
      slot_index,
      task_id,
      state_json
    )
    VALUES ($1, $2, $3, $4, $5::jsonb)
    RETURNING id`,
    [input.workflowTaskId, input.role, input.slotIndex, input.taskId, JSON.stringify(input.state ?? {})]
  );

  return { id: result.rows[0].id };
}

async function createLongHorizonWorkflowRecords(
  input: LongHorizonWorkflowInput,
  taskId: string,
  reviewerTaskIds: string[],
  reviewerCount: number,
  workflowTitle: string,
  enableClarifyPhase: boolean
): Promise<{ userMessageId: string; userMessageCreatedAt: string }> {
  return withTransaction(async (client) => {
    const parent = await insertTaskWithInitialUserMessage(client, {
      taskId,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      initiatorUserId: input.initiatorUserId,
      title: input.title,
      message: input.message,
      attachments: input.attachments,
      defaultTimezone: input.defaultTimezone,
      tools: input.tools,
      agent: input.agent,
      maxStepsOverride: input.maxStepsOverride,
      allowWaiting: input.allowWaiting,
      timeLimitSeconds: input.timeLimitSeconds,
      workflowType: "long_horizon",
      interactiveCanvasId: input.interactiveCanvasId,
      interactiveCanvasIntent: input.interactiveCanvasIntent
    });

    await setTaskBranchSelection({
      taskId,
      userId: input.initiatorUserId,
      activeLeafMessageId: parent.userMessageId,
      client
    });

    await insertWorkflowRow(client, {
      taskId,
      workflowType: "long_horizon",
      phase: enableClarifyPhase ? "clarify" : "working",
      config: {
        reviewerCount,
        tokenBudget: input.tokenBudget ?? null,
        timeBudgetMinutes: input.timeBudgetMinutes ?? null,
        enableClarifyPhase,
        enableReviewPhase: input.enableReviewPhase !== false,
        reviewMode: input.reviewMode ?? "standard",
        researchMode: input.researchMode ?? "standard"
      }
    });

    await insertWorkflowAgent(client, {
      workflowTaskId: taskId,
      role: "main",
      slotIndex: 0,
      taskId
    });

    for (let index = 0; index < reviewerTaskIds.length; index += 1) {
      const reviewerTaskId = reviewerTaskIds[index];
      await insertTaskWithInitialUserMessage(client, {
        taskId: reviewerTaskId,
        workspaceId: input.workspaceId,
        environmentId: input.environmentId,
        initiatorUserId: input.initiatorUserId,
        title: `${workflowTitle} · Reviewer ${index + 1}`,
        message: input.message,
        attachments: input.attachments,
        defaultTimezone: input.defaultTimezone,
        tools: input.tools,
        agent: input.agent,
        maxStepsOverride: input.maxStepsOverride,
        allowWaiting: false,
        timeLimitSeconds: input.timeLimitSeconds,
        workflowType: "long_horizon",
        workflowParentTaskId: taskId,
        workflowInternalRole: "reviewer",
        interactiveCanvasId: input.interactiveCanvasId,
        interactiveCanvasIntent: input.interactiveCanvasIntent
      });

      await insertWorkflowAgent(client, {
        workflowTaskId: taskId,
        role: "reviewer",
        slotIndex: index,
        taskId: reviewerTaskId
      });
    }

    if (input.timeLimitSeconds !== null && input.timeLimitSeconds !== undefined) {
      await activateTaskTimeLimitInTx(client, taskId, parent.userMessageCreatedAt);
    }

    return parent;
  });
}

export async function createLongHorizonWorkflowTask(input: LongHorizonWorkflowInput): Promise<{
  taskId: string;
  runId: string;
  userMessageId: string;
  reusedExisting: boolean;
}> {
  const taskId = input.taskId ?? randomUUID();
  const workflowTitle = input.title?.trim()
    || (input.reviewMode === "quality_control"
      ? "Quality Control Task"
      : input.researchMode === "deep_research" ? "Deep Research Task" : "Long Horizon Task");
  const enableClarifyPhase = input.enableClarifyPhase !== false;
  const enableReviewPhase = input.enableReviewPhase !== false;
  const reviewerCount = enableReviewPhase ? LONG_HORIZON_REVIEWER_COUNT : 0;
  const reviewerTaskIds = Array.from({ length: reviewerCount }, () => randomUUID());

  const existingBeforeCreate = input.taskId
    ? await findExistingWorkflowTask(taskId, input, "long_horizon")
    : null;
  if (existingBeforeCreate) {
    return reuseExistingWorkflowTask({
      existing: existingBeforeCreate,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      initiatorUserId: input.initiatorUserId,
      mode: enableClarifyPhase ? "long_horizon_clarify" : "long_horizon_main"
    });
  }

  let created: { userMessageId: string; userMessageCreatedAt: string };
  try {
    created = await createLongHorizonWorkflowRecords(
      input,
      taskId,
      reviewerTaskIds,
      reviewerCount,
      workflowTitle,
      enableClarifyPhase
    );
  } catch (error) {
    if (!input.taskId || !isTaskPrimaryKeyConflict(error)) {
      throw error;
    }
    const existing = await findExistingWorkflowTask(taskId, input, "long_horizon");
    if (!existing) {
      throw error;
    }
    return reuseExistingWorkflowTask({
      existing,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      initiatorUserId: input.initiatorUserId,
      mode: enableClarifyPhase ? "long_horizon_clarify" : "long_horizon_main"
    });
  }

  const run = await ensureWorkflowInitialRun({
    taskId,
    userMessageId: created.userMessageId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    initiatorUserId: input.initiatorUserId,
    mode: enableClarifyPhase ? "long_horizon_clarify" : "long_horizon_main"
  });

  return {
    taskId,
    runId: run.runId,
    userMessageId: created.userMessageId,
    reusedExisting: false
  };
}

async function createSwarmChannel(
  client: PoolClient,
  input: {
    workflowTaskId: string;
    kind: "global" | "direct" | "group";
    title: string | null;
    createdByWorkflowAgentId: string | null;
    memberAgentIds: string[];
  }
): Promise<{ id: string }> {
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO task_workflow_channels (
      workflow_task_id,
      kind,
      title,
      created_by_workflow_agent_id
    )
    VALUES ($1, $2, $3, $4)
    RETURNING id`,
    [input.workflowTaskId, input.kind, input.title, input.createdByWorkflowAgentId]
  );
  const channelId = inserted.rows[0].id;

  for (const workflowAgentId of input.memberAgentIds) {
    await client.query(
      `INSERT INTO task_workflow_channel_members (
        channel_id,
        workflow_agent_id
      )
      VALUES ($1, $2)`,
      [channelId, workflowAgentId]
    );
  }

  return { id: channelId };
}

async function insertAgentSwarmWorkflowRecords(
  client: PoolClient,
  input: BaseCreateWorkflowInput & {
    workerCount: number;
    reviewRounds: number;
    agentAllocations?: AgentSwarmAgentAllocation[];
    leaderAgentId?: string | null;
    compiledSwarm?: CompiledAgentSwarm;
    tokenBudget?: number | null;
    timeBudgetMinutes?: number | null;
    dynamicNodeTypes?: PlatformAgentPreset[];
  },
  taskId: string,
  workerTaskIds: string[],
  workerCount: number,
  agentAllocations: AgentSwarmAgentAllocation[]
) {
  const leader = await insertTaskWithInitialUserMessage(client, {
    taskId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    initiatorUserId: input.initiatorUserId,
    title: input.title,
    message: input.message,
    attachments: input.attachments,
    defaultTimezone: input.defaultTimezone,
    tools: input.tools,
    agent: input.agent,
    maxStepsOverride: input.maxStepsOverride,
    allowWaiting: input.allowWaiting,
    timeLimitSeconds: input.timeLimitSeconds,
    workflowType: "agent_swarm",
    workflowInternalRole: "leader",
    interactiveCanvasId: input.interactiveCanvasId,
    interactiveCanvasIntent: input.interactiveCanvasIntent
  });

  await setTaskBranchSelection({
    taskId,
    userId: input.initiatorUserId,
    activeLeafMessageId: leader.userMessageId,
    client
  });

  await insertWorkflowRow(client, {
    taskId,
    workflowType: "agent_swarm",
    phase: "active",
    config: {
      workerCount,
      reviewRounds: input.reviewRounds,
      modelAllocations: agentAllocations,
      leaderAgentId: input.leaderAgentId ?? null,
      compiledSwarm: input.compiledSwarm ?? null,
      tokenBudget: input.tokenBudget ?? null,
      timeBudgetMinutes: input.timeBudgetMinutes ?? null,
      dynamicNodeTypes: input.dynamicNodeTypes ?? [],
      selectedTools: normalizeTaskMessageToolOptions(input.tools) ?? {}
    }
  });

  const compiledSwarm = input.compiledSwarm;
  const rootNode = compiledSwarm?.nodes.find((node) => node.id === compiledSwarm.rootNodeId) ?? null;
  const leaderLeaf = rootNode
    ? compiledSwarm!.leaves.find((leaf) => leaf.id === rootNode.leaderLeafId) ?? null
    : null;
  const leaderAgent = await insertWorkflowAgent(client, {
    workflowTaskId: taskId,
    role: "leader",
    slotIndex: 0,
    taskId,
    state: leaderLeaf ? {
      agentPresetId: leaderLeaf.agentId,
      swarmLeafId: leaderLeaf.id,
      agentPresetMode: leaderLeaf.mode,
      swarmNodeIds: leaderLeaf.nodeIds,
      swarmLeaderNodeIds: leaderLeaf.leaderNodeIds,
      swarmParentNodeId: leaderLeaf.parentNodeId
    } : {}
  });

  const leafAgentIds = new Map<string, string>();
  if (leaderLeaf) {
    leafAgentIds.set(leaderLeaf.id, leaderAgent.id);
  }
  const workerAgentIds: string[] = [];
  const workerLeaves = compiledSwarm && rootNode
    ? compiledSwarm.leaves.filter((leaf) => leaf.id !== rootNode.leaderLeafId)
    : [];
  for (let index = 0; index < workerTaskIds.length; index += 1) {
    const workerTaskId = workerTaskIds[index];
    const leaf = workerLeaves[index] ?? null;
    await insertTaskWithInitialSystemMessage(client, {
      taskId: workerTaskId,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      initiatorUserId: input.initiatorUserId,
      title: `${input.title?.trim() || "Agent Swarm Task"} · ${leaf?.name ?? `Worker ${index + 1}`}`,
      message: buildSwarmWorkerBootstrapMessage({
        workerNumber: index + 1,
        userMessage: input.message
      }),
      defaultTimezone: input.defaultTimezone,
      maxStepsOverride: input.maxStepsOverride,
      allowWaiting: input.allowWaiting,
      timeLimitSeconds: input.timeLimitSeconds,
      workflowType: "agent_swarm",
      workflowParentTaskId: taskId,
      workflowInternalRole: "worker",
      interactiveCanvasId: input.interactiveCanvasId,
      interactiveCanvasIntent: input.interactiveCanvasIntent
    });

    const workerAgent = await insertWorkflowAgent(client, {
      workflowTaskId: taskId,
      role: "worker",
      slotIndex: index,
      taskId: workerTaskId,
      state: leaf ? {
        agentPresetId: leaf.agentId,
        swarmLeafId: leaf.id,
        agentPresetMode: leaf.mode,
        swarmNodeIds: leaf.nodeIds,
        swarmLeaderNodeIds: leaf.leaderNodeIds,
        swarmParentNodeId: leaf.parentNodeId
      } : {}
    });
    workerAgentIds.push(workerAgent.id);
    if (leaf) {
      leafAgentIds.set(leaf.id, workerAgent.id);
    }
  }

  if (compiledSwarm && rootNode) {
    const swarmChannelIds: Record<string, string> = {};
    for (const node of compiledSwarm.nodes) {
      const memberLeafIds = [node.leaderLeafId, ...node.workerLeafIds];
      const memberAgentIds = memberLeafIds.map((leafId) => leafAgentIds.get(leafId)).filter((id): id is string => Boolean(id));
      const channel = await createSwarmChannel(client, {
        workflowTaskId: taskId,
        kind: node.id === compiledSwarm.rootNodeId ? "global" : "group",
        title: node.id === compiledSwarm.rootNodeId ? "Global" : node.title,
        createdByWorkflowAgentId: leafAgentIds.get(node.leaderLeafId) ?? null,
        memberAgentIds
      });
      swarmChannelIds[node.id] = channel.id;
    }
    await client.query(
      `UPDATE task_workflows
          SET config_json = config_json || $2::jsonb,
              updated_at = now()
        WHERE task_id = $1`,
      [taskId, JSON.stringify({ swarmChannelIds })]
    );
  } else {
    await createSwarmChannel(client, {
      workflowTaskId: taskId,
      kind: "global",
      title: "Global",
      createdByWorkflowAgentId: leaderAgent.id,
      memberAgentIds: [leaderAgent.id, ...workerAgentIds]
    });
  }

  if (typeof input.tokenBudget === "number" && input.tokenBudget > 0) {
    const directWorkerAgentIds = rootNode
      ? rootNode.workerLeafIds.map((leafId) => leafAgentIds.get(leafId)).filter((id): id is string => Boolean(id))
      : workerAgentIds;
    const delegatedLeaderIds = new Set(compiledSwarm?.nodes
      .filter((node) => node.parentNodeId === rootNode?.id)
      .map((node) => leafAgentIds.get(node.leaderLeafId))
      .filter((id): id is string => Boolean(id)) ?? []);
    const estimate = calculateAgentSwarmBudgetEstimate({ minimumStepTokens: AGENT_SWARM_MINIMUM_INFERENCE_TOKENS, workerSlots: directWorkerAgentIds.length });
    const reserveTokens = calculateAgentSwarmSystemReserve(input.tokenBudget, AGENT_SWARM_MINIMUM_INFERENCE_TOKENS);
    if (input.tokenBudget < reserveTokens + estimate.minimumSpawnAllocationTokens) {
      throw new Error(`Agent Swarm token budget is too small. Minimum required for the initial roster is ${reserveTokens + estimate.minimumSpawnAllocationTokens} weighted tokens.`);
    }
    const deadlineAt = typeof input.timeBudgetMinutes === "number" && input.timeBudgetMinutes > 0
      ? new Date(Date.parse(leader.userMessageCreatedAt) + input.timeBudgetMinutes * 60_000).toISOString()
      : null;
    const quotaRoot = await client.query<{ id: string }>(
      `INSERT INTO task_workflow_swarm_nodes (
        workflow_task_id, node_type_id, node_key, generation, title, depth, status,
        leader_task_id, allocated_tokens, system_reserve_tokens,
        unassigned_tokens, deadline_at, created_by_workflow_agent_id
      ) VALUES ($1, $2, $3, 0, $4, 1, 'active', $5, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        taskId,
        input.leaderAgentId ?? null,
        rootNode?.id ?? "node-0",
        input.title?.trim() || "Agent Swarm",
        taskId,
        input.tokenBudget,
        reserveTokens,
        Math.max(0, input.tokenBudget - reserveTokens),
        deadlineAt,
        leaderAgent.id
      ]
    );
    const nodeId = quotaRoot.rows[0]?.id;
    if (nodeId) {
      const operatingTokens = Math.max(0, input.tokenBudget - reserveTokens);
      const { leaderLeaseTokens, workerLeaseTokens, unassignedTokens } = calculateAgentSwarmInitialLeases({
        operatingTokens,
        workerCount: directWorkerAgentIds.filter((id) => !delegatedLeaderIds.has(id)).length,
        minimumStepTokens: AGENT_SWARM_MINIMUM_INFERENCE_TOKENS
      });
      await client.query(
        `INSERT INTO task_workflow_swarm_node_members
          (node_id, workflow_agent_id, role, slot_index, lease_tokens)
         VALUES ($1, $2, 'leader', 0, $3)`,
        [nodeId, leaderAgent.id, leaderLeaseTokens]
      );
      for (let index = 0; index < directWorkerAgentIds.length; index += 1) {
        await client.query(
          `INSERT INTO task_workflow_swarm_node_members
            (node_id, workflow_agent_id, role, slot_index, lease_tokens)
           VALUES ($1, $2, 'worker', $3, $4)`,
          [nodeId, directWorkerAgentIds[index], index, delegatedLeaderIds.has(directWorkerAgentIds[index]) ? 0 : workerLeaseTokens]
        );
      }
      await client.query(
        `UPDATE task_workflow_swarm_nodes
            SET unassigned_tokens = $2
          WHERE id = $1`,
        [nodeId, unassignedTokens]
      );
      await client.query(
        `INSERT INTO task_workflow_swarm_quota_ledger
          (workflow_task_id, node_id, kind, amount_tokens, metadata_json)
         VALUES ($1, $2, 'root_grant', $3, $4::jsonb)`,
        [taskId, nodeId, input.tokenBudget, JSON.stringify({ deadlineAt })]
      );
      if (compiledSwarm && rootNode && compiledSwarm.nodes.length > 1) {
        await insertSeededSwarmQuotaNodesInTx(client, {
          workflowTaskId: taskId,
          compiledSwarm,
          rootQuotaNodeId: nodeId,
          agentIdsByLeaf: leafAgentIds
        });
      }
    }
  }

  if (input.timeLimitSeconds !== null && input.timeLimitSeconds !== undefined) {
    await activateTaskTimeLimitInTx(client, taskId, leader.userMessageCreatedAt);
  }

  return leader;
}

export async function createAgentSwarmWorkflowTask(input: AgentSwarmWorkflowInput): Promise<{
  taskId: string;
  runId: string;
  userMessageId: string;
  reusedExisting: boolean;
}> {
  const taskId = input.taskId ?? randomUUID();
  const workerCount = input.compiledSwarm
    ? Math.max(0, input.compiledSwarm.leaves.length - 1)
    : clampAgentSwarmWorkerCount(input.workerCount);
  const workerTaskIds = Array.from({ length: workerCount }, () => randomUUID());
  const agentAllocations = limitAgentSwarmAgentAllocations(input.agentAllocations ?? [], workerCount);

  const existingBeforeCreate = input.taskId
    ? await findExistingWorkflowTask(taskId, input, "agent_swarm")
    : null;
  if (existingBeforeCreate) {
    return reuseExistingWorkflowTask({
      existing: existingBeforeCreate,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      initiatorUserId: input.initiatorUserId,
      mode: "agent_swarm_leader",
      toolOptionsOverride: input.tools
    });
  }

  let created: Awaited<ReturnType<typeof insertAgentSwarmWorkflowRecords>>;
  try {
    created = await withTransaction((client) => insertAgentSwarmWorkflowRecords(
      client,
      input,
      taskId,
      workerTaskIds,
      workerCount,
      agentAllocations
    ));
  } catch (error) {
    if (!input.taskId || !isTaskPrimaryKeyConflict(error)) {
      throw error;
    }
    const existing = await findExistingWorkflowTask(taskId, input, "agent_swarm");
    if (!existing) {
      throw error;
    }
    return reuseExistingWorkflowTask({
      existing,
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      initiatorUserId: input.initiatorUserId,
      mode: "agent_swarm_leader",
      toolOptionsOverride: input.tools
    });
  }

  const leaderRun = await ensureWorkflowInitialRun({
    taskId,
    userMessageId: created.userMessageId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    initiatorUserId: input.initiatorUserId,
    mode: "agent_swarm_leader",
    toolOptionsOverride: input.tools
  });

  return {
    taskId,
    runId: leaderRun.runId,
    userMessageId: created.userMessageId,
    reusedExisting: false
  };
}

export interface TaskWorkflowOverview {
  type: TaskWorkflowType;
  phase: string;
  config: Record<string, unknown>;
  longHorizon?: {
    plan: {
      content: string | null;
      createdAt: string | null;
    };
    latestRound: number;
    latestSubmissionMessage: string | null;
    reviews: Array<{
      id: string;
      round_no: number | null;
      reviewer_task_id: string | null;
      reviewer_slot_index: number | null;
      approved: boolean;
      review: string;
      created_at: string;
    }>;
    reviewers: Array<{
      workflow_agent_id: string;
      task_id: string;
      slot_index: number;
      title: string | null;
      status: string;
      updated_at: string;
    }>;
  };
  agentSwarm?: {
    workerCount: number;
    channels: Array<{
      id: string;
      kind: "global" | "direct" | "group";
      title: string | null;
      member_task_ids: string[];
      created_at: string;
      latest_message_no: number | null;
    }>;
    workers: Array<{
      workflow_agent_id: string;
      role: "leader" | "worker";
      task_id: string;
      slot_index: number;
      title: string | null;
      status: string;
      updated_at: string;
    }>;
  };
}

interface TaskWorkflowRecord {
  workflow_type: TaskWorkflowType;
  phase: string;
  config_json: Record<string, unknown>;
  state_json: Record<string, unknown> | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function loadLongHorizonWorkflowOverview(
  taskId: string,
  workflow: TaskWorkflowRecord
): Promise<TaskWorkflowOverview> {
  const [planRes, latestSubmitRes, reviewsRes, reviewersRes] = await Promise.all([
    query<{ payload_json: { plan?: string }; created_at: string }>(
      `SELECT payload_json, created_at
         FROM task_workflow_submissions
        WHERE workflow_task_id = $1
          AND submission_type = 'plan'
        ORDER BY created_at DESC
        LIMIT 1`,
      [taskId]
    ),
    query<{ payload_json: { message?: string; roundNo?: number } }>(
      `SELECT payload_json
         FROM task_workflow_submissions
        WHERE workflow_task_id = $1
          AND submission_type = 'long_submit'
        ORDER BY created_at DESC
        LIMIT 1`,
      [taskId]
    ),
    query<{
      id: string;
      round_no: number | null;
      payload_json: { approved?: boolean; review?: string };
      created_at: string;
      reviewer_task_id: string | null;
      reviewer_slot_index: number | null;
    }>(
      `SELECT s.id,
              s.round_no,
              s.payload_json,
              s.created_at,
              a.task_id AS reviewer_task_id,
              a.slot_index AS reviewer_slot_index
         FROM task_workflow_submissions s
         LEFT JOIN task_workflow_agents a
           ON a.id = s.workflow_agent_id
        WHERE s.workflow_task_id = $1
          AND s.submission_type = 'review'
        ORDER BY s.round_no DESC NULLS LAST, a.slot_index ASC, s.created_at ASC`,
      [taskId]
    ),
    query<{
      workflow_agent_id: string;
      task_id: string;
      slot_index: number;
      title: string | null;
      status: string;
      updated_at: string;
    }>(
      `SELECT a.id AS workflow_agent_id,
              a.task_id,
              a.slot_index,
              t.title,
              t.status,
              t.updated_at
         FROM task_workflow_agents a
         JOIN tasks t ON t.id = a.task_id
        WHERE a.workflow_task_id = $1
          AND a.role = 'reviewer'
        ORDER BY a.slot_index ASC`,
      [taskId]
    )
  ]);

  return {
    type: workflow.workflow_type,
    phase: workflow.phase,
    config: workflow.config_json ?? {},
    longHorizon: {
      plan: {
        content: planRes.rows[0]?.payload_json?.plan ?? null,
        createdAt: planRes.rows[0]?.created_at ?? null
      },
      latestRound: Number(latestSubmitRes.rows[0]?.payload_json?.roundNo ?? 0) || 0,
      latestSubmissionMessage: latestSubmitRes.rows[0]?.payload_json?.message ?? null,
      reviews: reviewsRes.rows.map((row) => ({
        id: row.id,
        round_no: row.round_no,
        reviewer_task_id: row.reviewer_task_id,
        reviewer_slot_index: row.reviewer_slot_index,
        approved: row.payload_json?.approved === true,
        review: typeof row.payload_json?.review === "string" ? row.payload_json.review : "",
        created_at: row.created_at
      })),
      reviewers: reviewersRes.rows
    }
  };
}

async function loadAgentSwarmWorkflowOverview(
  taskId: string,
  workflow: TaskWorkflowRecord
): Promise<TaskWorkflowOverview> {
  const [channelsRes, workersRes] = await Promise.all([
    query<{
      id: string;
      kind: "global" | "direct" | "group";
      title: string | null;
      created_at: string;
      latest_message_no: number | null;
      member_task_ids: string[];
    }>(
      `SELECT c.id,
              c.kind,
              c.title,
              c.created_at,
              MAX(m.message_no)::bigint AS latest_message_no,
              ARRAY_REMOVE(ARRAY_AGG(DISTINCT a.task_id), NULL) AS member_task_ids
         FROM task_workflow_channels c
         LEFT JOIN task_workflow_messages m
           ON m.channel_id = c.id
         LEFT JOIN task_workflow_channel_members cm
           ON cm.channel_id = c.id
         LEFT JOIN task_workflow_agents a
           ON a.id = cm.workflow_agent_id
        WHERE c.workflow_task_id = $1
        GROUP BY c.id, c.kind, c.title, c.created_at
        ORDER BY c.created_at ASC, c.id ASC`,
      [taskId]
    ),
    // Every swarm agent except the root leader, including leaders of spawned child nodes.
    query<{
      workflow_agent_id: string;
      role: "leader" | "worker";
      task_id: string;
      slot_index: number;
      title: string | null;
      status: string;
      paused: boolean;
      pause_reason: string | null;
      updated_at: string;
    }>(
      `SELECT a.id AS workflow_agent_id,
              a.role,
              a.task_id,
              a.slot_index,
              t.title,
              t.status,
              t.updated_at
         FROM task_workflow_agents a
         JOIN tasks t ON t.id = a.task_id
        WHERE a.workflow_task_id = $1
          AND a.task_id <> $1
        ORDER BY t.created_at ASC, a.slot_index ASC`,
      [taskId]
    )
  ]);

  return {
    type: workflow.workflow_type,
    phase: workflow.phase,
    config: workflow.config_json ?? {},
    agentSwarm: {
      workerCount: workersRes.rows.length,
      channels: channelsRes.rows,
      workers: workersRes.rows.map((worker) => {
        const pauseRecord = asRecord(asRecord(workflow.state_json).pausedSwarmAgents)[worker.task_id];
        const pause = asRecord(pauseRecord);
        const pauseReason = typeof pause.status === "string" && pause.status.trim().length > 0
          ? pause.status
          : null;
        return {
          ...worker,
          paused: Object.keys(pause).length > 0,
          pause_reason: pauseReason
        };
      })
    }
  };
}

export async function getTaskWorkflowOverview(taskId: string): Promise<TaskWorkflowOverview | null> {
  const workflowRes = await query<TaskWorkflowRecord>(
    `SELECT workflow_type, phase, config_json, state_json
       FROM task_workflows
      WHERE task_id = $1`,
    [taskId]
  );

  if ((workflowRes.rowCount ?? 0) === 0) {
    return null;
  }

  const workflow = workflowRes.rows[0];

  return workflow.workflow_type === "long_horizon"
    ? loadLongHorizonWorkflowOverview(taskId, workflow)
    : loadAgentSwarmWorkflowOverview(taskId, workflow);
}

export async function listSwarmChannels(taskId: string): Promise<Array<{
  id: string;
  kind: "global" | "direct" | "group";
  title: string | null;
  created_at: string;
  latest_message_no: number | null;
  member_task_ids: string[];
}>> {
  const workflow = await getTaskWorkflowOverview(taskId);
  return workflow?.type === "agent_swarm" ? (workflow.agentSwarm?.channels ?? []) : [];
}

export async function listSwarmChannelMessages(taskId: string, channelId: string): Promise<Array<{
  id: string;
  channel_id: string;
  sender_task_id: string | null;
  sender_role: string | null;
  sender_slot_index: number | null;
  message_no: number;
  content_markdown: string;
  created_at: string;
}>> {
  const result = await query<{
    id: string;
    channel_id: string;
    sender_task_id: string | null;
    sender_role: string | null;
    sender_slot_index: number | null;
    message_no: number;
    content_markdown: string;
    created_at: string;
  }>(
    `SELECT m.id,
            m.channel_id,
            a.task_id AS sender_task_id,
            a.role AS sender_role,
            a.slot_index AS sender_slot_index,
            m.message_no,
            m.content_markdown,
            m.created_at
       FROM task_workflow_messages m
       JOIN task_workflow_channels c
         ON c.id = m.channel_id
       LEFT JOIN task_workflow_agents a
         ON a.id = m.sender_workflow_agent_id
      WHERE m.workflow_task_id = $1
        AND m.channel_id = $2
      ORDER BY m.message_no ASC`,
    [taskId, channelId]
  );

  return result.rows;
}
