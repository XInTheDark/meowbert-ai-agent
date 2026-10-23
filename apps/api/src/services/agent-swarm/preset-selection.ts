import type { PoolClient } from "pg";
import {
  findPlatformAgentPresetById,
  resolvePlatformAgentPresetMode,
  type PlatformAgentPreset,
  type TaskWorkflowType
} from "@meowbert/shared";
import { getVisiblePlatformAgentsForUser } from "../platform/platform-agents.js";
import { assertTaskTypeTransitionIdleInTx } from "../tasks/task-workflow-transitions.js";
import { enableAgentSwarmOnTaskInTx } from "./swarm-row.js";
import { resolveAgentSwarmSettings } from "./settings.js";

class SwarmSelectionConflictError extends Error {
  readonly statusCode = 409;
}

export async function resolveSelectedSwarmPreset(
  userId: string | undefined,
  agentId: string | undefined
): Promise<PlatformAgentPreset | null> {
  if (!userId || !agentId) return null;
  const { presets } = await getVisiblePlatformAgentsForUser(userId);
  const preset = findPlatformAgentPresetById(presets, agentId);
  return preset && resolvePlatformAgentPresetMode(preset) === "agent_swarm" ? preset : null;
}

// Picking a swarm preset in a standard task's follow-up turns the task into a swarm led by that
// preset; the conversation so far becomes the leader's. An existing swarm keeps its settings.
export async function applySelectedSwarmPresetInTx(
  client: PoolClient,
  input: { taskId: string; preset: PlatformAgentPreset }
): Promise<void> {
  const taskResult = await client.query<{ workflow_type: TaskWorkflowType | null }>(
    "SELECT workflow_type FROM tasks WHERE id = $1 FOR UPDATE",
    [input.taskId]
  );
  const task = taskResult.rows[0];
  if (!task) throw new Error(`Task not found: ${input.taskId}`);
  if (task.workflow_type === "agent_swarm") return;
  if (task.workflow_type !== null) {
    throw new SwarmSelectionConflictError("Change the task type to Standard before selecting an Agent Swarm preset.");
  }

  await assertTaskTypeTransitionIdleInTx(client, input.taskId);
  await enableAgentSwarmOnTaskInTx(client, input.taskId, resolveAgentSwarmSettings(undefined, input.preset));
  await client.query("DELETE FROM task_schedules WHERE task_id = $1", [input.taskId]);
}
