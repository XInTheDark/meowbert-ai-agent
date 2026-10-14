import { parseChosenModelRoute, resolveWorkspaceDefaultAgentId, type ChosenModelRoute } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { getVisiblePlatformAgentsForUser, requireVisiblePlatformAgentSelectionForUser } from "../platform/platform-agents.js";
import { createAgentSwarmTaskFromSettings } from "../tasks/agent-swarm-task-creation.js";
import { resolveAgentSwarmTaskSettings } from "../tasks/agent-swarm-task-settings.js";
import { resolveSelectedSwarm } from "../tasks/task-service/swarm-selection.js";
import { loadWorkspaceDefaultAgentId } from "../workspaces/workspace-default-agent.js";
import { cancelTaskAndSchedules } from "../tasks/task-cancellation.js";
import { ensureTaskHistoryWarm } from "../tasks/task-history.js";
import {
  appendTaskUserMessageAndEnqueue,
  createTaskWithInitialMessage,
  type TaskMessageAgentSelection,
  type TaskMessageToolOptions
} from "../tasks/task-service/index.js";
import { ProjectMasterError, type ProjectMasterTask } from "./master-task.js";

async function requireManagedTarget(master: ProjectMasterTask, targetTaskId: string): Promise<void> {
  if (targetTaskId === master.taskId) {
    throw new ProjectMasterError("The Master cannot target itself.", 400);
  }

  const result = await query<{ id: string }>(
    `SELECT id
       FROM tasks
      WHERE id = $1
        AND environment_id = $2
        AND parent_task_id IS NULL
        AND workflow_parent_task_id IS NULL
        AND trashed_at IS NULL
        AND is_hidden = false
        AND is_incognito = false`,
    [targetTaskId, master.environmentId]
  );
  if (!result.rows[0]) {
    throw new ProjectMasterError("Task not found in this project.", 404);
  }
}

async function loadMasterTimezone(masterTaskId: string): Promise<string> {
  const result = await query<{ default_timezone: string }>(
    "SELECT default_timezone FROM tasks WHERE id = $1",
    [masterTaskId]
  );
  return result.rows[0]?.default_timezone ?? "UTC";
}

// A swarm pick for the Master's tasks starts an Agent Swarm with the preset's own roster, as in the composer.
async function resolveManagedTaskSwarm(userId: string, workspaceId: string, agent: TaskMessageAgentSelection | undefined) {
  const { presets } = await getVisiblePlatformAgentsForUser(userId);
  const agentId = agent?.id ?? resolveWorkspaceDefaultAgentId(presets, await loadWorkspaceDefaultAgentId(workspaceId));
  const selected = await resolveSelectedSwarm(userId, agentId ?? undefined);
  return selected ? { ...selected, settings: resolveAgentSwarmTaskSettings(undefined, selected.preset) } : null;
}

// A caller-supplied task id makes retried tool calls reuse the same task. The task runs on the
// agent picked for the Master's tasks, and on the Master's router pick when that agent is a router.
export async function createManagedTask(input: {
  master: ProjectMasterTask;
  userId: string;
  taskId: string;
  title: string | null;
  message: string;
  tools?: TaskMessageToolOptions;
  agent: TaskMessageAgentSelection | null;
  modelRoute: ChosenModelRoute | null;
}): Promise<{ taskId: string; reusedExisting: boolean }> {
  const agent = await requireVisiblePlatformAgentSelectionForUser(input.userId, input.agent);
  const base = {
    taskId: input.taskId,
    workspaceId: input.master.workspaceId,
    environmentId: input.master.environmentId,
    initiatorUserId: input.userId,
    title: input.title ?? undefined,
    message: input.message,
    sender: "project_master" as const,
    tools: input.tools,
    agent,
    defaultTimezone: await loadMasterTimezone(input.master.taskId)
  };
  const swarm = await resolveManagedTaskSwarm(input.userId, input.master.workspaceId, agent);
  const created = swarm
    ? await createAgentSwarmTaskFromSettings(base, {
      compiledSwarm: swarm.compiled,
      swarmSettings: swarm.settings,
      agentAllocations: swarm.settings.modelAllocations,
      dynamicNodeTypes: swarm.dynamicNodeTypes
    })
    : await createTaskWithInitialMessage({ ...base, source: "web", modelRoute: input.modelRoute });
  return { taskId: created.taskId, reusedExisting: created.reusedExisting };
}

// A follow-up from the Master keeps the task on the agent and router pick its latest message used,
// so the task does not drop back to the workspace default.
async function loadTaskCurrentModel(taskId: string): Promise<{
  agent: TaskMessageAgentSelection | undefined;
  modelRoute: ChosenModelRoute | null;
}> {
  const result = await query<{ content_json: Record<string, unknown> }>(
    `SELECT content_json
       FROM task_messages
      WHERE task_id = $1 AND role = 'user'
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [taskId]
  );
  const content = result.rows[0]?.content_json ?? {};
  const agentId = (content.agent as { id?: unknown } | undefined)?.id;
  return {
    agent: typeof agentId === "string" ? { id: agentId } : undefined,
    modelRoute: parseChosenModelRoute(content.modelRoute)
  };
}

export async function messageManagedTask(input: {
  master: ProjectMasterTask;
  userId: string;
  taskId: string;
  message: string;
}): Promise<{ mode: "enqueued" | "interrupting" }> {
  await requireManagedTarget(input.master, input.taskId);
  await ensureTaskHistoryWarm(input.taskId);
  const current = await loadTaskCurrentModel(input.taskId);
  const run = await appendTaskUserMessageAndEnqueue({
    taskId: input.taskId,
    workspaceId: input.master.workspaceId,
    environmentId: input.master.environmentId,
    triggerSource: "web",
    message: input.message,
    sender: "project_master",
    agent: current.agent,
    modelRoute: current.modelRoute,
    userId: input.userId,
    interruptQueued: true
  });
  return { mode: run.mode };
}

export async function cancelManagedTask(input: { master: ProjectMasterTask; taskId: string }): Promise<void> {
  await requireManagedTarget(input.master, input.taskId);
  await cancelTaskAndSchedules(input.taskId);
}
