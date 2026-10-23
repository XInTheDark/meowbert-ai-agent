import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS,
  isPlatformAgentPresetPickerVisible,
  resolveDefaultPlatformAgentId,
  resolvePlatformAgentPresetMode,
  resolveWorkspaceDefaultAgentId,
  type PlatformAgentPreset
} from "@meowbert/shared";
import { getVisiblePlatformAgentsForUser } from "../services/platform/platform-agents.js";
import { assertWorkspaceMember } from "../services/workspaces/workspace-access.js";
import { loadWorkspaceDefaultAgentId } from "../services/workspaces/workspace-default-agent.js";

// The swarm defaults the composer prefills when a swarm preset is selected. Budget figures are sent
// even while budgets are off, so switching budgets on shows the preset's numbers. The platform's
// routers are listed so the composer can offer a router only when there is one.
function buildSwarmAgentSummary(preset: PlatformAgentPreset, routerOptions: string[]) {
  return {
    leaderAgentId: preset.leaderAgentId ?? null,
    routerId: preset.routerId ?? null,
    routerOptions,
    budgetsEnabled: preset.budgetsEnabled === true,
    tokenBudget: preset.tokenBudget ?? null,
    timeBudgetMinutes: preset.timeBudgetMinutes ?? null,
    advanced: preset.advanced ?? DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS
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
    const { presets, actorIsSuperAdmin, modelSliderAgentIds, modelRouterIds } = await getVisiblePlatformAgentsForUser(request.user.id);
    const workspaceDefaultAgentId = await loadRequestedWorkspaceDefaultAgentId(request.user.id, workspaceId);
    const pickerPresets = presets.filter(isPlatformAgentPresetPickerVisible);
    const agents = pickerPresets.map((preset) => {
      const mode = resolvePlatformAgentPresetMode(preset);
      return {
        id: preset.id,
        name: preset.name,
        description: preset.description,
        mode,
        ...(mode === "agent_swarm" ? { swarm: buildSwarmAgentSummary(preset, modelRouterIds ?? []) } : {})
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
