import type { PoolClient } from "pg";
import { isDeepStrictEqual } from "node:util";
import {
  compilePlatformAgentSwarm,
  findPlatformAgentPresetById,
  resolvePlatformAgentPresetMode,
  type CompiledAgentSwarm,
  type PlatformAgentPreset,
  type TaskWorkflowType
} from "@meowbert/shared";
import { getVisiblePlatformAgentsForUser } from "../../platform/platform-agents.js";
import { selectAgentSwarmNodeTypes } from "../agent-swarm-node-types.js";
import { resolveAgentSwarmTaskSettings } from "../agent-swarm-task-settings.js";
import { applyWorkflowTransitionInTx, assertTaskTypeTransitionIdleInTx } from "../task-workflow-transitions.js";

interface SelectedSwarm {
  preset: PlatformAgentPreset;
  compiled: CompiledAgentSwarm;
  dynamicNodeTypes: PlatformAgentPreset[];
}

class SwarmSelectionConflictError extends Error {
  readonly statusCode = 409;
}

export async function resolveSelectedSwarm(userId: string | undefined, agentId: string | undefined): Promise<SelectedSwarm | null> {
  if (!userId || !agentId) return null;
  const { presets } = await getVisiblePlatformAgentsForUser(userId);
  const preset = findPlatformAgentPresetById(presets, agentId);
  if (!preset || resolvePlatformAgentPresetMode(preset) !== "agent_swarm") return null;
  return {
    preset,
    compiled: compilePlatformAgentSwarm({
      presets,
      leaderAgentId: preset.leaderAgentId ?? "",
      modelAllocations: preset.modelAllocations ?? [],
      reviewRounds: preset.reviewRounds ?? 0,
      title: preset.name
    }),
    dynamicNodeTypes: selectAgentSwarmNodeTypes(presets)
  };
}

export async function applySelectedSwarmInTx(
  client: PoolClient,
  input: { taskId: string; userId: string; selectedSwarm: SelectedSwarm; prompt: string }
): Promise<void> {
  const taskResult = await client.query<{
    id: string;
    workspace_id: string;
    environment_id: string;
    default_timezone: string;
    allow_waiting: boolean;
    workflow_type: TaskWorkflowType | null;
    title: string | null;
  }>(
    `SELECT id, workspace_id, environment_id, default_timezone, allow_waiting, workflow_type, title
       FROM tasks WHERE id = $1 FOR UPDATE`,
    [input.taskId]
  );
  const task = taskResult.rows[0];
  if (!task) throw new Error(`Task not found: ${input.taskId}`);
  if (task.workflow_type === "agent_swarm") {
    const workflowResult = await client.query<{ config_json: Record<string, unknown> }>(
      `SELECT config_json FROM task_workflows WHERE task_id = $1`,
      [input.taskId]
    );
    if (isDeepStrictEqual(workflowResult.rows[0]?.config_json?.compiledSwarm, input.selectedSwarm.compiled)) {
      return;
    }
    throw new SwarmSelectionConflictError("Change the Agent Swarm workflow in task settings before selecting a different swarm preset.");
  }
  if (task.workflow_type !== null) {
    throw new SwarmSelectionConflictError("Change the task type to Standard before selecting an Agent Swarm preset.");
  }

  await assertTaskTypeTransitionIdleInTx(client, input.taskId);
  const settings = resolveAgentSwarmTaskSettings(undefined, input.selectedSwarm.preset);
  await applyWorkflowTransitionInTx(client, {
    taskId: input.taskId,
    userId: input.userId,
    task,
    workflow: {
      type: "agent_swarm",
      workerCount: Math.max(0, input.selectedSwarm.compiled.leaves.length - 1),
      reviewRounds: settings.reviewRounds,
      leaderAgentId: settings.leaderAgentId,
      modelAllocations: settings.modelAllocations,
      tokenBudget: settings.tokenBudget,
      timeBudgetMinutes: settings.timeBudgetMinutes,
      disableSpawningAndBudgets: settings.disableSpawningAndBudgets
    },
    compiledSwarm: input.selectedSwarm.compiled,
    promptOverride: input.prompt,
    dynamicNodeTypes: input.selectedSwarm.dynamicNodeTypes
  });
  await client.query(`DELETE FROM task_schedules WHERE task_id = $1`, [input.taskId]);
}
