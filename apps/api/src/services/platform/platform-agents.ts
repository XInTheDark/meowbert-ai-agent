import {
  findPlatformAgentPresetById,
  getVisiblePlatformAgentPresets,
  normalizeAgentSwarmAgentAllocations,
  resolveDefaultPlatformAgentId,
  type AgentSwarmAgentAllocation,
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
}> {
  const [settings, actorIsSuperAdmin, subscriptionAgentIds] = await Promise.all([
    getAdminSettings(),
    isSuperAdmin(userId),
    listActiveSubscriptionPlanAgentIdsForUser(userId)
  ]);
  const visiblePresets = getVisiblePlatformAgentPresets(settings.agentPresets, actorIsSuperAdmin);

  if (actorIsSuperAdmin || subscriptionAgentIds.length === 0) {
    return {
      actorIsSuperAdmin,
      presets: visiblePresets,
      modelSliderAgentIds: settings.modelSliderAgentIds
    };
  }

  const visiblePresetIds = new Set(visiblePresets.map((preset) => preset.id));
  const grantedAgentIds = new Set(subscriptionAgentIds);
  const grantedPresets = getVisiblePlatformAgentPresets(settings.agentPresets, true)
    .filter((preset) => grantedAgentIds.has(preset.id) && !visiblePresetIds.has(preset.id));

  return {
    actorIsSuperAdmin,
    presets: [...visiblePresets, ...grantedPresets],
    modelSliderAgentIds: settings.modelSliderAgentIds
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
}> {
  const { actorIsSuperAdmin, presets, modelSliderAgentIds } = await resolveVisiblePlatformAgentContext(userId);

  return {
    actorIsSuperAdmin,
    presets,
    defaultAgentId: resolveDefaultPlatformAgentId(presets),
    modelSliderAgentIds: actorIsSuperAdmin ? modelSliderAgentIds : []
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

export async function requireVisiblePlatformAgentAllocationsForUser(
  userId: string,
  input: unknown
): Promise<AgentSwarmAgentAllocation[]> {
  const normalizedAllocations = normalizeAgentSwarmAgentAllocations(input);
  if (normalizedAllocations.length === 0) {
    return [];
  }

  const { presets } = await resolveVisiblePlatformAgentContext(userId);
  const visiblePresetIds = new Set(presets.map((preset) => preset.id));

  for (const allocation of normalizedAllocations) {
    if (!visiblePresetIds.has(allocation.agentId)) {
      throw new Error(`Agent not found: ${allocation.agentId}`);
    }
  }

  return normalizedAllocations;
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
