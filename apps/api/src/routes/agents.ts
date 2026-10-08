import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  compilePlatformAgentSwarm,
  isPlatformAgentPresetPickerVisible,
  resolveDefaultPlatformAgentId,
  resolvePlatformAgentPresetMode,
  resolveWorkspaceDefaultAgentId,
  type PlatformAgentPreset
} from "@meowbert/shared";
import { resolveAgentSwarmTaskSettings } from "../services/tasks/agent-swarm-task-settings.js";
import { getVisiblePlatformAgentsForUser } from "../services/platform/platform-agents.js";
import { assertWorkspaceMember } from "../services/workspaces/workspace-access.js";
import { loadWorkspaceDefaultAgentId } from "../services/workspaces/workspace-default-agent.js";

// The composer edits a selected swarm's top-level roster, so it needs the members' names even when they
// are hidden from the agent picker.
function buildSwarmAgentSummary(preset: PlatformAgentPreset, presets: PlatformAgentPreset[]) {
  const settings = resolveAgentSwarmTaskSettings(undefined, preset);
  const memberIds = new Set([settings.leaderAgentId, ...settings.modelAllocations.map((item) => item.agentId)]);
  return {
    leaderAgentId: settings.leaderAgentId,
    modelAllocations: settings.modelAllocations,
    reviewRounds: settings.reviewRounds,
    tokenBudget: settings.tokenBudget,
    timeBudgetMinutes: settings.timeBudgetMinutes,
    disableSpawningAndBudgets: settings.disableSpawningAndBudgets,
    members: presets
      .filter((member) => memberIds.has(member.id))
      .map((member) => ({ id: member.id, name: member.name, mode: resolvePlatformAgentPresetMode(member) }))
  };
}

const agentsQuery = z.object({ workspaceId: z.string().uuid().optional() });

async function loadRequestedWorkspaceDefaultAgentId(userId: string, workspaceId: string | undefined): Promise<string | null> {
  if (!workspaceId) return null;
  await assertWorkspaceMember(workspaceId, userId);
  return loadWorkspaceDefaultAgentId(workspaceId);
}

export const agentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/api/agents", { preHandler: fastify.authenticate }, async (request, reply) => {
    const { workspaceId } = agentsQuery.parse(request.query ?? {});
    const { presets, actorIsSuperAdmin, modelSliderAgentIds } = await getVisiblePlatformAgentsForUser(request.user.id);
    const workspaceDefaultAgentId = await loadRequestedWorkspaceDefaultAgentId(request.user.id, workspaceId);
    const pickerPresets = presets.filter(isPlatformAgentPresetPickerVisible);
    const agents = pickerPresets.map((preset) => {
      const mode = resolvePlatformAgentPresetMode(preset);
      let swarmWorkerCount: number | null = null;
      if (mode === "agent_swarm") {
        try {
          const compiled = compilePlatformAgentSwarm({
            presets,
            leaderAgentId: preset.leaderAgentId ?? "",
            modelAllocations: preset.modelAllocations ?? [],
            reviewRounds: preset.reviewRounds ?? 0
          });
          swarmWorkerCount = Math.max(0, compiled.leaves.length - 1);
        } catch {
          // A Swarm with inaccessible references remains unselectable at task creation.
        }
      }
      return {
        id: preset.id,
        name: preset.name,
        description: preset.description,
        mode,
        ...(swarmWorkerCount !== null
          ? {
              swarmWorkerCount,
              swarmReviewRounds: preset.reviewRounds ?? 0,
              swarm: buildSwarmAgentSummary(preset, presets)
            }
          : {})
      };
    });

    reply.header("Cache-Control", "private, no-cache");
    return {
      agents,
      defaultAgentId: resolveWorkspaceDefaultAgentId(pickerPresets, workspaceDefaultAgentId),
      platformDefaultAgentId: resolveDefaultPlatformAgentId(pickerPresets),
      ...(actorIsSuperAdmin ? { modelSliderAgentIds } : {})
    };
  });
};
