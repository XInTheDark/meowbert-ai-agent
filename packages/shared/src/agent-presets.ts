import { normalizeAgentPresetPayload } from "./responses-settings.js";
import {
  clampAgentSwarmReviewRounds,
  limitAgentSwarmAgentAllocations,
  normalizeAgentSwarmTimeBudgetMinutes,
  normalizeAgentSwarmTokenBudget,
  normalizeAgentSwarmAgentAllocations,
  sumAgentSwarmAgentAllocations,
  type AgentSwarmAgentAllocation
} from "./agent-swarm.js";
import { AGENT_SWARM_MAX_ACTIVE_AGENTS, AGENT_SWARM_MAX_ACTIVE_NODES } from "./agent-swarm-quota.js";

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
  spawnableAsNode?: boolean;
  payload: Record<string, unknown>;
  mode?: PlatformAgentPresetMode;
  leaderAgentId?: string;
  modelAllocations?: AgentSwarmAgentAllocation[];
  reviewRounds?: number;
  // Agent Swarm task defaults. Keep these in step with the swarm task parameters (TaskWorkflowComposerConfig).
  tokenBudget?: number;
  timeBudgetMinutes?: number;
  disableSpawningAndBudgets?: boolean;
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
    ...(typeof preset.spawnableAsNode === "boolean" ? { spawnableAsNode: preset.spawnableAsNode } : {}),
    payload: deepCloneJsonValue(preset.payload) as Record<string, unknown>,
    ...(preset.mode ? { mode: preset.mode } : {}),
    ...(preset.leaderAgentId ? { leaderAgentId: preset.leaderAgentId } : {}),
    ...(preset.modelAllocations ? { modelAllocations: preset.modelAllocations.map((item) => ({ ...item })) } : {}),
    ...(typeof preset.reviewRounds === "number" ? { reviewRounds: preset.reviewRounds } : {}),
    ...swarmBudgetFields(preset)
  };
}

// Budgets are swarm task defaults; disabling spawning and budgets wins over any budget values.
function swarmBudgetFields(raw: Record<string, unknown> | PlatformAgentPreset): Pick<
  PlatformAgentPreset,
  "tokenBudget" | "timeBudgetMinutes" | "disableSpawningAndBudgets"
> {
  if (raw.disableSpawningAndBudgets === true) {
    return { disableSpawningAndBudgets: true };
  }
  const tokenBudget = normalizeAgentSwarmTokenBudget(raw.tokenBudget);
  const timeBudgetMinutes = normalizeAgentSwarmTimeBudgetMinutes(raw.timeBudgetMinutes);
  return {
    ...(tokenBudget !== null ? { tokenBudget } : {}),
    ...(timeBudgetMinutes !== null ? { timeBudgetMinutes } : {})
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
    const modelAllocations = limitAgentSwarmAgentAllocations(
      normalizeAgentSwarmAgentAllocations(rawPreset.modelAllocations)
    );
    if (!leaderAgentId) {
      return null;
    }

    return {
      id,
      name,
      description,
      requiresSuperAdmin,
      ...(rawPreset.hidden === true ? { hidden: true } : {}),
      ...(typeof rawPreset.spawnableAsNode === "boolean" ? { spawnableAsNode: rawPreset.spawnableAsNode } : {}),
      payload: normalizeAgentPresetPayload(deepCloneJsonValue(rawPreset.payload) as Record<string, unknown>),
      mode,
      leaderAgentId,
      modelAllocations,
      reviewRounds: clampAgentSwarmReviewRounds(rawPreset.reviewRounds),
      ...swarmBudgetFields(rawPreset)
    };
  }

  return {
    id,
    name,
    description,
    requiresSuperAdmin,
    ...(rawPreset.hidden === true ? { hidden: true } : {}),
    ...(typeof rawPreset.spawnableAsNode === "boolean" ? { spawnableAsNode: rawPreset.spawnableAsNode } : {}),
    payload: normalizeAgentPresetPayload(deepCloneJsonValue(rawPreset.payload) as Record<string, unknown>),
    ...(mode === "quality_control_reviewer" ? { mode } : {})
  };
}

export function resolvePlatformAgentPresetMode(preset: PlatformAgentPreset | null | undefined): PlatformAgentPresetMode {
  return preset?.mode ?? "standard";
}

export function validatePlatformAgentPresetGraph(presets: PlatformAgentPreset[]): string[] {
  const byId = new Map(presets.map((preset) => [preset.id, preset]));
  const errors: string[] = [];

  for (const preset of presets) {
    if (resolvePlatformAgentPresetMode(preset) !== "agent_swarm") {
      continue;
    }
    const referencedIds = [preset.leaderAgentId, ...(preset.modelAllocations ?? []).map((item) => item.agentId)];
    for (const referencedId of referencedIds) {
      if (!referencedId || !byId.has(referencedId)) {
        errors.push(`Agent Swarm preset ${preset.id} references unknown agent ${referencedId ?? "<missing>"}.`);
      }
    }
  }

  const visit = (presetId: string, swarmDepth: number, path: string[]): void => {
    const preset = byId.get(presetId);
    if (!preset || resolvePlatformAgentPresetMode(preset) !== "agent_swarm") {
      return;
    }
    if (swarmDepth > 3) {
      errors.push(`Agent Swarm preset ${path[0] ?? presetId} exceeds the maximum nesting depth of 3.`);
      return;
    }
    const references = [preset.leaderAgentId, ...(preset.modelAllocations ?? []).map((item) => item.agentId)]
      .filter((value): value is string => Boolean(value));
    for (const referenceId of references) {
      if (path.includes(referenceId)) {
        errors.push(`Agent Swarm preset cycle: ${[...path, referenceId].join(" -> ")}.`);
        continue;
      }
      visit(referenceId, swarmDepth + 1, [...path, referenceId]);
    }
  };

  for (const preset of presets) {
    visit(preset.id, 1, [preset.id]);
  }
  return Array.from(new Set(errors));
}

export interface CompiledAgentSwarmLeaf {
  id: string;
  agentId: string;
  name: string;
  mode: PlatformAgentPresetMode;
  nodeIds: string[];
  leaderNodeIds: string[];
  parentNodeId: string | null;
}

export interface CompiledAgentSwarmNode {
  id: string;
  parentNodeId: string | null;
  title: string;
  leaderLeafId: string;
  workerLeafIds: string[];
  reviewRounds: number;
}

export interface CompiledAgentSwarm {
  rootNodeId: string;
  nodes: CompiledAgentSwarmNode[];
  leaves: CompiledAgentSwarmLeaf[];
}

export function compilePlatformAgentSwarm(input: {
  presets: PlatformAgentPreset[];
  leaderAgentId: string;
  modelAllocations: AgentSwarmAgentAllocation[];
  reviewRounds?: number;
  title?: string;
}): CompiledAgentSwarm {
  const errors = validatePlatformAgentPresetGraph(input.presets);
  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }
  const byId = new Map(input.presets.map((preset) => [preset.id, preset]));
  const leaves: CompiledAgentSwarmLeaf[] = [];
  const nodes: CompiledAgentSwarmNode[] = [];
  let nextLeaf = 0;
  let nextNode = 0;

  const expandSeat = (agentId: string, parentNodeId: string | null): string => {
    const preset = byId.get(agentId);
    if (!preset) {
      throw new Error(`Agent not found: ${agentId}`);
    }
    if (resolvePlatformAgentPresetMode(preset) !== "agent_swarm") {
      const id = `leaf-${nextLeaf++}`;
      leaves.push({
        id,
        agentId: preset.id,
        name: preset.name,
        mode: resolvePlatformAgentPresetMode(preset),
        nodeIds: [],
        leaderNodeIds: [],
        parentNodeId
      });
      return id;
    }

    return expandNode({
      parentNodeId,
      title: preset.name,
      leaderAgentId: preset.leaderAgentId!,
      modelAllocations: preset.modelAllocations ?? [],
      reviewRounds: preset.reviewRounds ?? 0
    }).leaderLeafId;
  };

  const expandNode = (nodeInput: {
    parentNodeId: string | null;
    title: string;
    leaderAgentId: string;
    modelAllocations: AgentSwarmAgentAllocation[];
    reviewRounds: number;
  }): CompiledAgentSwarmNode => {
    const id = `node-${nextNode++}`;
    const leaderLeafId = expandSeat(nodeInput.leaderAgentId, id);
    const workerLeafIds: string[] = [];
    for (const allocation of nodeInput.modelAllocations) {
      for (let count = 0; count < allocation.workerCount; count += 1) {
        workerLeafIds.push(expandSeat(allocation.agentId, id));
      }
    }
    const node: CompiledAgentSwarmNode = {
      id,
      parentNodeId: nodeInput.parentNodeId,
      title: nodeInput.title,
      leaderLeafId,
      workerLeafIds,
      reviewRounds: nodeInput.reviewRounds
    };
    nodes.push(node);
    const leader = leaves.find((leaf) => leaf.id === leaderLeafId)!;
    leader.nodeIds.push(id);
    leader.leaderNodeIds.push(id);
    for (const workerLeafId of workerLeafIds) {
      const worker = leaves.find((leaf) => leaf.id === workerLeafId)!;
      worker.nodeIds.push(id);
    }
    return node;
  };

  const root = expandNode({
    parentNodeId: null,
    title: input.title ?? "Agent Swarm",
    leaderAgentId: input.leaderAgentId,
    modelAllocations: input.modelAllocations,
    reviewRounds: input.reviewRounds ?? 0
  });
  const overcommittedLeaf = leaves.find((leaf) => leaf.nodeIds.length > 2);
  if (overcommittedLeaf) {
    throw new Error(`Agent ${overcommittedLeaf.name} belongs to more than two Agent Swarms.`);
  }
  if (nodes.length > AGENT_SWARM_MAX_ACTIVE_NODES || leaves.length > AGENT_SWARM_MAX_ACTIVE_AGENTS) {
    throw new Error(`Agent Swarm exceeds the limit of ${AGENT_SWARM_MAX_ACTIVE_NODES} nodes or ${AGENT_SWARM_MAX_ACTIVE_AGENTS} agents.`);
  }
  return { rootNodeId: root.id, nodes, leaves };
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
