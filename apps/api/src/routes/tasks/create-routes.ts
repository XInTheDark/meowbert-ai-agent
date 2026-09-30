import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  compilePlatformAgentSwarm,
  findPlatformAgentPresetById,
  resolvePlatformAgentPresetMode,
  resolveWorkspaceDefaultAgentId,
  sumAgentSwarmAgentAllocations,
  AGENT_SWARM_DEFAULT_TOKEN_BUDGET,
  type CompiledAgentSwarm,
  type AgentSwarmAgentAllocation,
  type PlatformAgentPreset
} from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { createLongHorizonWorkflowTask, createAgentSwarmWorkflowTask } from "../../services/tasks/task-workflows.js";
import { selectAgentSwarmNodeTypes } from "../../services/tasks/agent-swarm-node-types.js";
import { ensureEnvironmentStorageRoot } from "../../services/environments/environment-storage.js";
import { assertCanvasBelongsToProject, touchProjectCanvasTask } from "../../services/canvases/project-canvases.js";
import { getPromptEntitlementStatus, recordPromptUsageIfRequired } from "../../services/billing/entitlements.js";
import {
  requireVisiblePlatformAgentAllocationsForUser,
  requireVisiblePlatformAgentSelectionForUser,
  getVisiblePlatformAgentsForUser
} from "../../services/platform/platform-agents.js";
import { createTaskWithInitialMessage } from "../../services/tasks/task-service/index.js";
import { resolveTaskScheduleConfig, normalizeTimezoneOrThrow } from "../../services/tasks/task-schedule-config.js";
import { assertEnvironmentMember } from "../../services/workspaces/workspace-access.js";
import { loadWorkspaceDefaultAgentId } from "../../services/workspaces/workspace-default-agent.js";
import { environmentEntityPaths } from "../environments/shared.js";
import { assertRecurringTaskLimits, buildEntitlementExceededPayload, createTaskBodySchema, environmentParams } from "./shared.js";

interface ResolvedScheduleInput {
  mode: "scheduled" | "infinite";
  repeat: string | null;
  timezone: string;
  nextRunAt: string | null;
  enabledTools?: {
    webSearch?: boolean;
    memorySearch?: boolean;
    scheduleTask?: boolean;
    subtasks?: boolean;
    computerUse?: boolean;
    interactiveCanvas?: boolean;
    enabledSkills?: string[];
    enabledSources?: string[];
  };
  createdByUserId?: string | null;
  runTimeoutSeconds?: number | null;
  runDeadlineAt?: string | null;
}

async function loadEnvironmentForTaskCreation(envId: string): Promise<{ id: string; workspace_id: string; root_path: string }> {
  const environmentRes = await query<{ id: string; workspace_id: string; root_path: string }>(
    `SELECT id, workspace_id, root_path
       FROM environments
      WHERE id = $1`,
    [envId]
  );
  if ((environmentRes.rowCount ?? 0) === 0) {
    throw new Error("Project not found");
  }
  return environmentRes.rows[0];
}

async function buildRecurringScheduleInput(input: {
  workspaceId: string;
  environmentId: string;
  userId: string;
  tools: ResolvedScheduleInput["enabledTools"];
  resolvedSchedule: ReturnType<typeof resolveTaskScheduleConfig>;
}): Promise<{ scheduleInput: ResolvedScheduleInput | null; initialRunMode: "default" | "scheduled_auto" | "infinite_auto" }> {
  if (!input.resolvedSchedule) {
    return { scheduleInput: null, initialRunMode: "default" };
  }

  await assertRecurringTaskLimits(input.workspaceId, input.environmentId);
  return {
    scheduleInput: {
      ...input.resolvedSchedule,
      enabledTools: input.tools,
      createdByUserId: input.userId
    },
    initialRunMode: input.resolvedSchedule.mode === "scheduled" ? "scheduled_auto" : "infinite_auto"
  };
}

async function createRequestedTask(input: {
  body: ReturnType<typeof createTaskBodySchema.parse>;
  environmentId: string;
  userId: string;
  workspaceId: string;
  defaultTimezone: string;
  initialRunMode: "default" | "scheduled_auto" | "infinite_auto";
  scheduleInput: ResolvedScheduleInput | null;
  selectedAgent: Awaited<ReturnType<typeof requireVisiblePlatformAgentSelectionForUser>>;
  agentSwarmAgentAllocations: AgentSwarmAgentAllocation[];
  compiledSwarm: CompiledAgentSwarm | null;
  selectedSwarmPreset: PlatformAgentPreset | null;
  dynamicNodeTypes: Awaited<ReturnType<typeof getVisiblePlatformAgentsForUser>>["presets"];
}): Promise<{ taskId: string; runId: string; userMessageId: string; reusedExisting: boolean }> {
  const baseInput = {
    taskId: input.body.taskId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    initiatorUserId: input.userId,
    title: input.body.title,
    message: input.body.message,
    attachments: input.body.attachments,
    defaultTimezone: input.defaultTimezone,
    maxStepsOverride: input.body.parameters?.maxSteps ?? null,
    allowWaiting: input.body.parameters?.allowWaiting,
    timeLimitSeconds: input.body.parameters?.timeLimitSeconds ?? null,
    isIncognito: input.body.incognito === true,
    tools: input.body.tools,
    agent: input.selectedAgent,
    interactiveCanvasId: input.body.interactiveCanvasId ?? null,
    interactiveCanvasIntent: input.body.interactiveCanvasIntent ?? (input.body.interactiveCanvasId ? "update" : null)
  };

  if (!input.body.workflow && !input.compiledSwarm) {
    return createTaskWithInitialMessage({
      ...baseInput,
      source: "web",
      schedule: input.scheduleInput,
      initialRunMode: input.initialRunMode,
      initialRunToolOptionsOverride: input.scheduleInput?.enabledTools,
      initialRunQuickMode:
        input.initialRunMode === "default"
        && input.body.quickMode === true
        && !input.body.interactiveCanvasId
        && input.body.tools?.interactiveCanvas !== true
    });
  }
  const workflow = input.body.workflow;
  if (
    workflow?.type === "long_horizon"
    || workflow?.type === "deep_research"
    || workflow?.type === "quality_control"
  ) {
    const created = await createLongHorizonWorkflowTask({
      ...baseInput,
      tokenBudget: workflow.tokenBudget ?? null,
      timeBudgetMinutes: workflow.timeBudgetMinutes ?? null,
      enableClarifyPhase: workflow.enableClarifyPhase,
      enableReviewPhase: workflow.enableReviewPhase,
      reviewMode: workflow.type === "quality_control" ? "quality_control" : "standard",
      researchMode: workflow.type === "deep_research" ? "deep_research" : "standard"
    });
    return created;
  }

  const allocationWorkerCount = sumAgentSwarmAgentAllocations(input.agentSwarmAgentAllocations);
  const rootNode = input.compiledSwarm?.nodes.find((node) => node.id === input.compiledSwarm?.rootNodeId) ?? null;
  const created = await createAgentSwarmWorkflowTask({
    ...baseInput,
    workerCount: input.compiledSwarm
      ? Math.max(0, input.compiledSwarm.leaves.length - 1)
      : allocationWorkerCount > 0 ? allocationWorkerCount : input.body.workflow?.workerCount ?? 2,
    reviewRounds: input.selectedSwarmPreset?.reviewRounds ?? input.body.workflow?.reviewRounds ?? rootNode?.reviewRounds ?? 0,
    agentAllocations: input.agentSwarmAgentAllocations,
    leaderAgentId: input.selectedSwarmPreset?.leaderAgentId ?? input.body.workflow?.leaderAgentId ?? null,
    compiledSwarm: input.compiledSwarm ?? undefined,
    ...(input.body.workflow?.disableSpawningAndBudgets === true
      ? { tokenBudget: null, timeBudgetMinutes: null, dynamicNodeTypes: [] }
      : {
          tokenBudget: input.body.workflow?.tokenBudget ?? AGENT_SWARM_DEFAULT_TOKEN_BUDGET,
          timeBudgetMinutes: input.body.workflow?.timeBudgetMinutes ?? null,
          dynamicNodeTypes: input.dynamicNodeTypes
        })
  });
  return created;
}

async function handleCreateTask(request: FastifyRequest, reply: FastifyReply) {
  const params = environmentParams.parse(request.params);
  const body = createTaskBodySchema.parse(request.body);
  const access = await assertEnvironmentMember(params.envId, request.user.id);
  const entitlement = await getPromptEntitlementStatus(request.user.id);

  if (!entitlement.allowed) {
    return reply.status(429).send(buildEntitlementExceededPayload(entitlement));
  }

  const environment = await loadEnvironmentForTaskCreation(params.envId);
  await ensureEnvironmentStorageRoot(environment);

  const selectedAgent = await requireVisiblePlatformAgentSelectionForUser(request.user.id, body.agent);
  const visibleAgentContext = await getVisiblePlatformAgentsForUser(request.user.id);
  const defaultAgentId = resolveWorkspaceDefaultAgentId(
    visibleAgentContext.presets,
    await loadWorkspaceDefaultAgentId(access.workspaceId)
  );
  const selectedPreset = findPlatformAgentPresetById(
    visibleAgentContext.presets,
    selectedAgent?.id ?? defaultAgentId
  );
  const selectedSwarmPreset = (!body.workflow || body.workflow.type === "agent_swarm")
    && resolvePlatformAgentPresetMode(selectedPreset) === "agent_swarm" ? selectedPreset : null;
  const requestedSwarm = body.workflow?.type === "agent_swarm" && !selectedSwarmPreset;
  const agentSwarmAgentAllocations = selectedSwarmPreset?.modelAllocations
    ?? (requestedSwarm
      ? await requireVisiblePlatformAgentAllocationsForUser(request.user.id, body.workflow?.modelAllocations)
      : []);
  let compiledSwarm: CompiledAgentSwarm | null = null;
  if (requestedSwarm || selectedSwarmPreset) {
    try {
      compiledSwarm = compilePlatformAgentSwarm({
        presets: visibleAgentContext.presets,
        leaderAgentId: selectedSwarmPreset?.leaderAgentId
          ?? body.workflow?.leaderAgentId ?? selectedAgent?.id ?? defaultAgentId ?? "",
        modelAllocations: agentSwarmAgentAllocations,
        reviewRounds: selectedSwarmPreset?.reviewRounds ?? body.workflow?.reviewRounds ?? 0,
        title: selectedPreset?.name
      });
    } catch (error) {
      return reply.status(400).send({ error: error instanceof Error ? error.message : "Invalid Agent Swarm configuration." });
    }
  }
  const defaultTimezone = normalizeTimezoneOrThrow(body.clientTimezone);
  if ((body.workflow || compiledSwarm) && body.schedule) {
    return reply.status(400).send({ error: "Workflow tasks cannot use schedules in v1." });
  }
  if (body.incognito === true && (body.workflow || compiledSwarm || body.schedule)) {
    return reply.status(400).send({ error: "Incognito chat is only available for standard tasks." });
  }

  const resolvedSchedule = resolveTaskScheduleConfig(body.schedule ?? null, { defaultTimezone, now: new Date() });
  if (body.interactiveCanvasId) {
    await assertCanvasBelongsToProject({
      canvasId: body.interactiveCanvasId,
      workspaceId: access.workspaceId,
      environmentId: params.envId
    });
  }
  const { scheduleInput, initialRunMode } = await buildRecurringScheduleInput({
    workspaceId: access.workspaceId,
    environmentId: params.envId,
    userId: request.user.id,
    tools: body.tools,
    resolvedSchedule
  });

  const created = await createRequestedTask({
    body,
    environmentId: params.envId,
    userId: request.user.id,
    workspaceId: access.workspaceId,
    defaultTimezone,
    initialRunMode,
    scheduleInput,
    selectedAgent,
    agentSwarmAgentAllocations,
    compiledSwarm,
    selectedSwarmPreset,
    dynamicNodeTypes: selectAgentSwarmNodeTypes(visibleAgentContext.presets)
  });

  if (!created.reusedExisting) {
    if (body.interactiveCanvasId) {
      await touchProjectCanvasTask({
        canvasId: body.interactiveCanvasId,
        taskId: created.taskId
      });
    }
    await recordPromptUsageIfRequired({
      userId: request.user.id,
      mode: entitlement.mode,
      taskId: created.taskId,
      taskMessageId: created.userMessageId
    });
  }

  return reply.status(created.reusedExisting ? 200 : 201).send(created);
}

export async function registerTaskCreateRoutes(fastify: FastifyInstance): Promise<void> {
  for (const environmentPath of environmentEntityPaths) {
    fastify.post(`${environmentPath}/tasks`, { preHandler: fastify.authenticate }, handleCreateTask);
  }
}
