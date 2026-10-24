import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  findPlatformAgentPresetById,
  resolvePlatformAgentPresetMode,
  resolveWorkspaceDefaultAgentId,
  type AgentSwarmSettings,
  type PlatformAgentPreset
} from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { config } from "../../lib/config.js";
import { loadLocalProjectStorage, localTaskFeatureError } from "../../services/devices/execution-targets.js";
import { createLongHorizonWorkflowTask } from "../../services/tasks/task-workflows.js";
import { createAgentSwarmTask } from "../../services/agent-swarm/creation.js";
import { resolveAgentSwarmSettings } from "../../services/agent-swarm/settings.js";
import { ensureEnvironmentStorageRoot } from "../../services/environments/environment-storage.js";
import { assertCanvasBelongsToProject, touchProjectCanvasTask } from "../../services/canvases/project-canvases.js";
import { getPromptEntitlementStatus, recordPromptUsageIfRequired } from "../../services/billing/entitlements.js";
import {
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
  swarmSettings: AgentSwarmSettings | null;
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
    interactiveCanvasIntent: input.body.interactiveCanvasIntent ?? (input.body.interactiveCanvasId ? "update" : null),
    executionTarget: input.body.executionTarget
  };

  if (!input.body.workflow && !input.swarmSettings) {
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

  if (!input.swarmSettings) {
    throw new Error("Agent Swarm settings are missing.");
  }
  return createAgentSwarmTask({ ...baseInput, settings: input.swarmSettings });
}

// A swarm's leader must be a single agent the user can run.
function isUsableSwarmLeader(presets: PlatformAgentPreset[], settings: AgentSwarmSettings): boolean {
  if (!settings.leaderAgentId) {
    return true;
  }
  const leader = findPlatformAgentPresetById(presets, settings.leaderAgentId);
  return Boolean(leader && resolvePlatformAgentPresetMode(leader) !== "agent_swarm");
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
  if (body.executionTarget?.kind !== "local") await ensureEnvironmentStorageRoot(environment);

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
  const swarmSettings = body.workflow?.type === "agent_swarm" || selectedSwarmPreset
    ? resolveAgentSwarmSettings(body.workflow?.type === "agent_swarm" ? body.workflow : undefined, selectedSwarmPreset)
    : null;
  if (swarmSettings && !isUsableSwarmLeader(visibleAgentContext.presets, swarmSettings)) {
    return reply.status(400).send({ error: "This Agent Swarm's leader agent is not available to you." });
  }
  if (body.executionTarget?.kind === "local") {
    if (!config.localExecution.enabled || config.runApi === undefined) {
      return reply.status(400).send({ error: "Local execution is disabled on this server." });
    }
    const featureError = localTaskFeatureError({ workflow: body.workflow, schedule: body.schedule, swarm: !!swarmSettings, tools: body.tools });
    if (featureError) return reply.status(400).send({ error: featureError });
    const device = await query<{ id: string }>(
      `SELECT id FROM devices WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND platform = 'darwin' AND architecture = 'arm64'`,
      [body.executionTarget.deviceId, request.user.id]
    );
    if ((device.rowCount ?? 0) === 0) {
      return reply.status(400).send({ error: "The selected local device is unavailable." });
    }
    try { await loadLocalProjectStorage(params.envId); }
    catch (error) { return reply.status(400).send({ error: error instanceof Error ? error.message : String(error) }); }
  }
  if (body.executionTarget?.kind === "local") await ensureEnvironmentStorageRoot(environment);
  const defaultTimezone = normalizeTimezoneOrThrow(body.clientTimezone);
  if ((body.workflow || swarmSettings) && body.schedule) {
    return reply.status(400).send({ error: "Workflow tasks cannot use schedules in v1." });
  }
  if (body.incognito === true && (body.workflow || swarmSettings || body.schedule)) {
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
    swarmSettings
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
