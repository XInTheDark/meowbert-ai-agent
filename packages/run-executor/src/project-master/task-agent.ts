import {
  findPlatformModelRouterById,
  reasoningScoreForEffort,
  type ChosenModelRoute,
  type ChosenModelRouteEffort,
  getVisiblePlatformAgentPresets,
  getWorkspaceDefaultAgentId,
  resolvePlatformAgentPresetMode,
  type PlatformModelRouter
} from "@meowbert/shared";
import { resolveAgentPresetByIdOrDefault } from "../agent/agent-preset-resolution.js";
import type { TaskMessageRow, TaskSnapshot } from "../agent/types.js";

// The agent the Master's tasks run on, picked in the Master's own composer. A null agentId
// means the workspace default. When that agent is a model router, the Master picks one of the
// router's targets for each task instead of the router deciding.
export interface ProjectMasterTaskAgent {
  agentId: string | null;
  router: PlatformModelRouter | null;
  isSwarm: boolean;
}

// Chat apps send no pick, so the latest message that carried one still applies.
export function pickProjectMasterTaskAgentId(messages: TaskMessageRow[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const taskAgent = message.content_json.taskAgent;
    if (typeof taskAgent !== "object" || taskAgent === null) continue;
    const id = (taskAgent as Record<string, unknown>).id;
    return typeof id === "string" && id.trim() ? id.trim().toLowerCase() : null;
  }
  return null;
}

export function resolveProjectMasterTaskAgent(snapshot: TaskSnapshot, actorIsSuperAdmin: boolean): ProjectMasterTaskAgent {
  const agentId = pickProjectMasterTaskAgentId(snapshot.messages);
  const preset = resolveAgentPresetByIdOrDefault(
    agentId,
    getVisiblePlatformAgentPresets(snapshot.platform_agent_presets, actorIsSuperAdmin),
    getWorkspaceDefaultAgentId(snapshot.workspace_model_defaults)
  );
  const mode = resolvePlatformAgentPresetMode(preset);
  const model = preset?.payload.model;
  const router = mode === "standard" && typeof model === "string"
    ? findPlatformModelRouterById(snapshot.platform_model_routers, model)
    : null;
  return { agentId, router, isSwarm: mode === "agent_swarm" };
}

// Turns the Master's create_task pick into the route the new task's run will use.
export function buildChosenModelRoute(
  router: PlatformModelRouter | null,
  modelId: string | null | undefined,
  effort: ChosenModelRouteEffort | null | undefined
): ChosenModelRoute | null {
  if (!router) return null;
  if (!modelId || !router.models.some((target) => target.id === modelId)) {
    throw new Error(`Pick a model for the task from: ${router.models.map((target) => target.id).join(", ")}.`);
  }
  return { routerId: router.id, modelId, reasoningScore: reasoningScoreForEffort(effort ?? null) };
}
