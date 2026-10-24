import { normalizeAgentPresetPayload } from "./responses-settings.js";
import {
  normalizeAgentSwarmAdvancedSettings,
  normalizeAgentSwarmSpawnEffort,
  normalizeAgentSwarmTimeBudgetMinutes,
  normalizeAgentSwarmTokenBudget,
  type AgentSwarmAdvancedSettings
} from "./agent-swarm-config.js";

export const PLATFORM_AGENT_PRESET_MODE_VALUES = [
  "standard",
  "agent_swarm",
  "quality_control_reviewer"
] as const;

export type PlatformAgentPresetMode = typeof PLATFORM_AGENT_PRESET_MODE_VALUES[number];

export interface PlatformAgentPreset {
  id: string;
  name: string;
  description: string;
  requiresSuperAdmin: boolean;
  hidden?: boolean;
  payload: Record<string, unknown>;
  mode?: PlatformAgentPresetMode;
  // Agent Swarm defaults. Keep these in step with the swarm task parameters in the composer
  // (see agent-swarm-config.ts and the preset contract in AGENTS.md).
  leaderAgentId?: string;
  routerId?: string | null;
  spawnEffort?: number;
  budgetsEnabled?: boolean;
  tokenBudget?: number;
  timeBudgetMinutes?: number;
  advanced?: AgentSwarmAdvancedSettings;
}

const MAX_AGENT_PRESETS = 100;
const MAX_TEXT_LENGTH = 240;

export const DEFAULT_PLATFORM_AGENT_PRESETS: PlatformAgentPreset[] = [
  {
    id: "default",
    name: "Default",
    description: "Balanced defaults for most tasks.",
    requiresSuperAdmin: false,
    payload: {
      model: "gpt-5.3-codex",
      responses: {
        reasoning: {
          effort: "high",
          summary: "detailed"
        }
      }
    }
  },
  {
    id: "deep-think",
    name: "Deep think",
    description: "Higher reasoning effort for complex problems.",
    requiresSuperAdmin: false,
    payload: {
      model: "gpt-5.3-codex",
      responses: {
        reasoning: {
          effort: "xhigh",
          summary: "detailed"
        }
      }
    }
  },
  {
    id: "fast",
    name: "Fast",
    description: "Lower reasoning effort for quick turnarounds.",
    requiresSuperAdmin: false,
    payload: {
      model: "gpt-5.3-codex",
      responses: {
        reasoning: {
          effort: "low",
          summary: "detailed"
        }
      }
    }
  }
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepCloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => deepCloneJsonValue(entry));
  }

  if (isPlainObject(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      clone[key] = deepCloneJsonValue(entry);
    }
    return clone;
  }

  return value;
}

function clonePreset(preset: PlatformAgentPreset): PlatformAgentPreset {
  return {
    id: preset.id,
    name: preset.name,
    description: preset.description,
    requiresSuperAdmin: preset.requiresSuperAdmin,
    ...(preset.hidden === true ? { hidden: true } : {}),
    payload: deepCloneJsonValue(preset.payload) as Record<string, unknown>,
    ...(preset.mode ? { mode: preset.mode } : {}),
    ...(preset.leaderAgentId ? { leaderAgentId: preset.leaderAgentId } : {}),
    ...(preset.routerId !== undefined ? { routerId: preset.routerId } : {}),
    ...(typeof preset.spawnEffort === "number" ? { spawnEffort: preset.spawnEffort } : {}),
    ...(typeof preset.budgetsEnabled === "boolean" ? { budgetsEnabled: preset.budgetsEnabled } : {}),
    ...(typeof preset.tokenBudget === "number" ? { tokenBudget: preset.tokenBudget } : {}),
    ...(typeof preset.timeBudgetMinutes === "number" ? { timeBudgetMinutes: preset.timeBudgetMinutes } : {}),
    ...(preset.advanced ? { advanced: { ...preset.advanced } } : {})
  };
}

// The swarm defaults a preset carries. Budget figures are kept even while budgets are off, so the
// composer can show them when the user switches budgets on.
function swarmPresetFields(raw: Record<string, unknown>): Pick<
  PlatformAgentPreset,
  "routerId" | "spawnEffort" | "budgetsEnabled" | "tokenBudget" | "timeBudgetMinutes" | "advanced"
> {
  const tokenBudget = normalizeAgentSwarmTokenBudget(raw.tokenBudget);
  const timeBudgetMinutes = normalizeAgentSwarmTimeBudgetMinutes(raw.timeBudgetMinutes);
  return {
    routerId: normalizeId(raw.routerId),
    spawnEffort: normalizeAgentSwarmSpawnEffort(raw.spawnEffort),
    budgetsEnabled: raw.budgetsEnabled === true,
    ...(tokenBudget !== null ? { tokenBudget } : {}),
    ...(timeBudgetMinutes !== null ? { timeBudgetMinutes } : {}),
    advanced: normalizeAgentSwarmAdvancedSettings(raw.advanced)
  };
}

export function clonePlatformAgentPresets(presets: PlatformAgentPreset[]): PlatformAgentPreset[] {
  return presets.map((preset) => clonePreset(preset));
}

function normalizeId(rawId: unknown): string | null {
  if (typeof rawId !== "string") {
    return null;
  }

  const normalized = rawId.trim().toLowerCase();
  if (!normalized || normalized.length > MAX_TEXT_LENGTH) {
    return null;
  }

  return normalized;
}

function normalizeText(rawText: unknown): string | null {
  if (typeof rawText !== "string") {
    return null;
  }

  const normalized = rawText.trim();
  if (!normalized || normalized.length > MAX_TEXT_LENGTH) {
    return null;
  }

  return normalized;
}

function normalizePresetMode(value: unknown): PlatformAgentPresetMode | null {
  if (value === undefined || value === null || value === "") {
    return "standard";
  }
  return PLATFORM_AGENT_PRESET_MODE_VALUES.includes(value as PlatformAgentPresetMode)
    ? value as PlatformAgentPresetMode
    : null;
}

function normalizeSwarmLeaderAgentId(value: unknown): string | null {
  return normalizeId(value);
}

function normalizePreset(rawPreset: unknown): PlatformAgentPreset | null {
  if (!isPlainObject(rawPreset)) {
    return null;
  }

  const id = normalizeId(rawPreset.id);
  const name = normalizeText(rawPreset.name);
  const description = normalizeText(rawPreset.description);
  const requiresSuperAdmin = rawPreset.requiresSuperAdmin === true;
  const mode = normalizePresetMode(rawPreset.mode);

  if (!id || !name || !description || !mode || !isPlainObject(rawPreset.payload)) {
    return null;
  }

  if (mode === "agent_swarm") {
    const leaderAgentId = normalizeSwarmLeaderAgentId(rawPreset.leaderAgentId);
    if (!leaderAgentId) {
      return null;
    }

    return {
      id,
      name,
      description,
      requiresSuperAdmin,
      ...(rawPreset.hidden === true ? { hidden: true } : {}),
      payload: normalizeAgentPresetPayload(deepCloneJsonValue(rawPreset.payload) as Record<string, unknown>),
      mode,
      leaderAgentId,
      ...swarmPresetFields(rawPreset)
    };
  }

  return {
    id,
    name,
    description,
    requiresSuperAdmin,
    ...(rawPreset.hidden === true ? { hidden: true } : {}),
    payload: normalizeAgentPresetPayload(deepCloneJsonValue(rawPreset.payload) as Record<string, unknown>),
    ...(mode === "quality_control_reviewer" ? { mode } : {})
  };
}

export function resolvePlatformAgentPresetMode(preset: PlatformAgentPreset | null | undefined): PlatformAgentPresetMode {
  return preset?.mode ?? "standard";
}

// Swarm presets must name an existing single-agent leader; a swarm cannot lead another swarm.
export function validatePlatformAgentPresetReferences(presets: PlatformAgentPreset[]): string[] {
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  const errors: string[] = [];
  for (const preset of presets) {
    if (resolvePlatformAgentPresetMode(preset) !== "agent_swarm") {
      continue;
    }
    const leader = preset.leaderAgentId ? byId.get(preset.leaderAgentId) : undefined;
    if (!leader) {
      errors.push(`Agent Swarm preset ${preset.id} references unknown agent ${preset.leaderAgentId ?? "<missing>"}.`);
    } else if (resolvePlatformAgentPresetMode(leader) === "agent_swarm") {
      errors.push(`Agent Swarm preset ${preset.id} must be led by a single agent, not the swarm ${leader.id}.`);
    }
  }
  return errors;
}

export function normalizePlatformAgentPresets(rawValue: unknown): PlatformAgentPreset[] {
  if (!Array.isArray(rawValue)) {
    return clonePlatformAgentPresets(DEFAULT_PLATFORM_AGENT_PRESETS);
  }

  const normalized: PlatformAgentPreset[] = [];
  const seenIds = new Set<string>();

  for (const rawPreset of rawValue.slice(0, MAX_AGENT_PRESETS)) {
    const preset = normalizePreset(rawPreset);
    if (!preset || seenIds.has(preset.id)) {
      continue;
    }

    seenIds.add(preset.id);
    normalized.push(preset);
  }

  if (normalized.length === 0) {
    return clonePlatformAgentPresets(DEFAULT_PLATFORM_AGENT_PRESETS);
  }

  return normalized;
}

export function resolveDefaultPlatformAgentId(presets: PlatformAgentPreset[]): string | null {
  const defaultPreset = presets.find((preset) => preset.id === "default");
  if (defaultPreset) {
    return defaultPreset.id;
  }

  return presets[0]?.id ?? null;
}

// Only single-agent presets can be an implicit default; Swarms are always chosen explicitly.
export function isPlatformAgentPresetDefaultEligible(preset: PlatformAgentPreset): boolean {
  return isPlatformAgentPresetPickerVisible(preset) && resolvePlatformAgentPresetMode(preset) === "standard";
}

// Prefers the workspace's default agent when the viewer can use it, otherwise the platform default.
export function resolveWorkspaceDefaultAgentId(
  presets: PlatformAgentPreset[],
  workspaceDefaultAgentId: string | null | undefined
): string | null {
  const workspaceDefault = workspaceDefaultAgentId
    ? presets.find((preset) => preset.id === workspaceDefaultAgentId)
    : undefined;
  return workspaceDefault && isPlatformAgentPresetDefaultEligible(workspaceDefault)
    ? workspaceDefault.id
    : resolveDefaultPlatformAgentId(presets);
}

export function findPlatformAgentPresetById(
  presets: PlatformAgentPreset[],
  presetId: string | null | undefined
): PlatformAgentPreset | null {
  const normalizedId = normalizeId(presetId);
  if (!normalizedId) {
    return null;
  }

  return presets.find((preset) => preset.id === normalizedId) ?? null;
}

export function isPlatformAgentPresetVisible(
  preset: PlatformAgentPreset,
  actorIsSuperAdmin: boolean
): boolean {
  return actorIsSuperAdmin || preset.requiresSuperAdmin !== true;
}

export function getVisiblePlatformAgentPresets(
  presets: PlatformAgentPreset[],
  actorIsSuperAdmin: boolean
): PlatformAgentPreset[] {
  return presets
    .filter((preset) => isPlatformAgentPresetVisible(preset, actorIsSuperAdmin))
    .map((preset) => clonePreset(preset));
}

export function isPlatformAgentPresetPickerVisible(preset: PlatformAgentPreset): boolean {
  return preset.hidden !== true;
}
