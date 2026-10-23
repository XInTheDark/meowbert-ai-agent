import {
  findPlatformAgentPresetById,
  getVisiblePlatformAgentPresets,
  resolveDefaultPlatformAgentId,
  type PlatformAgentPreset
} from "@meowbert/shared";
import { getAdminSettings, isSuperAdmin } from "../admin/admin-settings.js";
import { listActiveSubscriptionPlanAgentIdsForUser } from "../billing/subscriptions.js";

export interface AgentSelectionInput {
  id?: string;
}

async function resolveVisiblePlatformAgentContext(userId: string): Promise<{
  actorIsSuperAdmin: boolean;
  presets: PlatformAgentPreset[];
  modelSliderAgentIds: string[];
  modelRouterIds: string[];
}> {
  const [settings, actorIsSuperAdmin, subscriptionAgentIds] = await Promise.all([
    getAdminSettings(),
    isSuperAdmin(userId),
    listActiveSubscriptionPlanAgentIdsForUser(userId)
  ]);
  const visiblePresets = getVisiblePlatformAgentPresets(settings.agentPresets, actorIsSuperAdmin);
  const modelRouterIds = settings.modelRouters.map((router) => router.id);

  if (actorIsSuperAdmin || subscriptionAgentIds.length === 0) {
    return {
      actorIsSuperAdmin,
      presets: visiblePresets,
      modelSliderAgentIds: settings.modelSliderAgentIds,
      modelRouterIds
    };
  }

  const visiblePresetIds = new Set(visiblePresets.map((preset) => preset.id));
  const grantedAgentIds = new Set(subscriptionAgentIds);
  const grantedPresets = getVisiblePlatformAgentPresets(settings.agentPresets, true)
    .filter((preset) => grantedAgentIds.has(preset.id) && !visiblePresetIds.has(preset.id));

  return {
    actorIsSuperAdmin,
    presets: [...visiblePresets, ...grantedPresets],
    modelSliderAgentIds: settings.modelSliderAgentIds,
    modelRouterIds
  };
}

function normalizeAgentSelectionId(input: AgentSelectionInput | null | undefined): string | null {
  if (typeof input?.id !== "string") {
    return null;
  }

  const normalizedId = input.id.trim().toLowerCase();
  return normalizedId.length > 0 ? normalizedId : null;
}

export async function getVisiblePlatformAgentsForUser(userId: string): Promise<{
  actorIsSuperAdmin: boolean;
  presets: PlatformAgentPreset[];
  defaultAgentId: string | null;
  modelSliderAgentIds: string[];
  // The platform's model routers, which Agent Swarm presets can pick lane models from.
  modelRouterIds: string[];
}> {
  const { actorIsSuperAdmin, presets, modelSliderAgentIds, modelRouterIds } = await resolveVisiblePlatformAgentContext(userId);

  return {
    actorIsSuperAdmin,
    presets,
    defaultAgentId: resolveDefaultPlatformAgentId(presets),
    modelSliderAgentIds: actorIsSuperAdmin ? modelSliderAgentIds : [],
    modelRouterIds
  };
}

export async function requireVisiblePlatformAgentSelectionForUser(
  userId: string,
  input: AgentSelectionInput | null | undefined
): Promise<{ id: string } | undefined> {
  const normalizedId = normalizeAgentSelectionId(input);
  if (!normalizedId) {
    return undefined;
  }

  const { presets } = await resolveVisiblePlatformAgentContext(userId);
  const preset = findPlatformAgentPresetById(presets, normalizedId);
  if (!preset) {
    throw new Error(`Agent not found: ${normalizedId}`);
  }

  return { id: normalizedId };
}

export async function filterVisiblePlatformAgentSelectionForUser(
  userId: string,
  input: AgentSelectionInput | null | undefined
): Promise<{ id: string } | undefined> {
  const normalizedId = normalizeAgentSelectionId(input);
  if (!normalizedId) {
    return undefined;
  }

  const { presets } = await resolveVisiblePlatformAgentContext(userId);
  const preset = findPlatformAgentPresetById(presets, normalizedId);
  return preset ? { id: normalizedId } : undefined;
}
