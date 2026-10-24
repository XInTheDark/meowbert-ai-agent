// Agent Swarm settings: what a swarm preset carries and what a swarm task freezes at creation.
// Every value here is configurable per preset and per task; keep the composer, the admin preset
// editor and the API resolution in step with these fields.

export const AGENT_SWARM_DEFAULT_TOKEN_BUDGET = 10_000_000;
export const AGENT_SWARM_MAX_TOKEN_BUDGET = 100_000_000;
export const AGENT_SWARM_MAX_TIME_BUDGET_MINUTES = 10_080;
// The smallest inference a lane step makes. With budgets on, a lane's share must cover a few steps.
export const AGENT_SWARM_MINIMUM_STEP_TOKENS = 8_192;
export const AGENT_SWARM_MINIMUM_LANE_STEPS = 4;
// Lane levels below the leader can never exceed this, whatever a preset says.
export const AGENT_SWARM_MAX_DEPTH = 3;
export const AGENT_SWARM_SPAWN_EFFORT_MIN = 1;
export const AGENT_SWARM_SPAWN_EFFORT_MAX = 5;
export const DEFAULT_AGENT_SWARM_SPAWN_EFFORT = 3;

export interface AgentSwarmAdvancedSettings {
  maxLanesPerParent: number;
  maxDepth: number;
  maxRunningLanes: number;
  laneMaxSteps: number | null;
  reconNudgeSteps: number;
  forkCompactionThresholdTokens: number;
  laneSummaryMaxTokens: number;
  assemblyHintTokens: number;
  dormantLaneTurns: number;
  autoCheck: boolean;
  budgetReservePercent: number;
  laneWrapUpPercent: number;
}

export interface AgentSwarmSettings {
  // The leader's agent preset; null runs the leader on the task's selected agent.
  leaderAgentId: string | null;
  routerId: string | null;
  spawnEffort: number;
  budgetsEnabled: boolean;
  tokenBudget: number | null;
  timeBudgetMinutes: number | null;
  advanced: AgentSwarmAdvancedSettings;
}

export interface AgentSwarmSpawnLimits {
  maxLanesPerParent: number;
  maxDepth: number;
  reconNudgeSteps: number;
}

type IntegerAdvancedField = Exclude<keyof AgentSwarmAdvancedSettings, "laneMaxSteps" | "autoCheck">;

export const AGENT_SWARM_ADVANCED_RANGES: Record<IntegerAdvancedField, { min: number; max: number }> & {
  laneMaxSteps: { min: number; max: number };
} = {
  maxLanesPerParent: { min: 1, max: 16 },
  maxDepth: { min: 1, max: AGENT_SWARM_MAX_DEPTH },
  maxRunningLanes: { min: 1, max: 128 },
  laneMaxSteps: { min: 1, max: 500 },
  reconNudgeSteps: { min: 0, max: 100 },
  forkCompactionThresholdTokens: { min: 10_000, max: 400_000 },
  laneSummaryMaxTokens: { min: 256, max: 8_000 },
  assemblyHintTokens: { min: 1_000, max: 200_000 },
  dormantLaneTurns: { min: 0, max: 20 },
  budgetReservePercent: { min: 5, max: 50 },
  laneWrapUpPercent: { min: 50, max: 95 }
};

export const DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS: AgentSwarmAdvancedSettings = {
  maxLanesPerParent: 8,
  maxDepth: 2,
  maxRunningLanes: 32,
  laneMaxSteps: null,
  reconNudgeSteps: 12,
  forkCompactionThresholdTokens: 200_000,
  laneSummaryMaxTokens: 1_500,
  assemblyHintTokens: 15_000,
  dormantLaneTurns: 3,
  autoCheck: true,
  budgetReservePercent: 15,
  laneWrapUpPercent: 80
};

const INTEGER_ADVANCED_FIELDS = Object.keys(AGENT_SWARM_ADVANCED_RANGES)
  .filter((field) => field !== "laneMaxSteps") as IntegerAdvancedField[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampInteger(value: unknown, range: { min: number; max: number }): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.min(range.max, Math.max(range.min, Math.floor(value)));
}

function normalizePositiveBudget(value: unknown, max: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.min(max, Math.max(1, Math.floor(value)));
}

export function normalizeAgentSwarmSpawnEffort(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_AGENT_SWARM_SPAWN_EFFORT;
  }
  return Math.min(AGENT_SWARM_SPAWN_EFFORT_MAX, Math.max(AGENT_SWARM_SPAWN_EFFORT_MIN, Math.floor(value)));
}

// Effort scales only delegation behavior. The balanced profile is exactly the existing behavior;
// budgets, lane steps and the provider concurrency cap stay independent safety controls.
const SPAWN_EFFORT_MULTIPLIERS: Record<number, { fanOut: number; depth: number; nudge: number }> = {
  1: { fanOut: 0.5, depth: 0.5, nudge: 2 },
  2: { fanOut: 0.75, depth: 0.5, nudge: 1.5 },
  3: { fanOut: 1, depth: 1, nudge: 1 },
  4: { fanOut: 1.25, depth: 1.25, nudge: 0.75 },
  5: { fanOut: 1.5, depth: 1.5, nudge: 0.5 }
};

function scaleInteger(value: number, multiplier: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, Math.round(value * multiplier)));
}

export function resolveAgentSwarmSpawnLimits(settings: Pick<AgentSwarmSettings, "spawnEffort" | "advanced">): AgentSwarmSpawnLimits {
  const multipliers = SPAWN_EFFORT_MULTIPLIERS[normalizeAgentSwarmSpawnEffort(settings.spawnEffort)];
  return {
    maxLanesPerParent: scaleInteger(settings.advanced.maxLanesPerParent, multipliers.fanOut, AGENT_SWARM_ADVANCED_RANGES.maxLanesPerParent),
    maxDepth: scaleInteger(settings.advanced.maxDepth, multipliers.depth, AGENT_SWARM_ADVANCED_RANGES.maxDepth),
    reconNudgeSteps: settings.advanced.reconNudgeSteps === 0
      ? 0
      : scaleInteger(settings.advanced.reconNudgeSteps, multipliers.nudge, AGENT_SWARM_ADVANCED_RANGES.reconNudgeSteps)
  };
}

function normalizeId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const id = value.trim().toLowerCase();
  return id.length > 0 ? id : null;
}

export function normalizeAgentSwarmTokenBudget(value: unknown): number | null {
  return normalizePositiveBudget(value, AGENT_SWARM_MAX_TOKEN_BUDGET);
}

export function normalizeAgentSwarmTimeBudgetMinutes(value: unknown): number | null {
  return normalizePositiveBudget(value, AGENT_SWARM_MAX_TIME_BUDGET_MINUTES);
}

// Fills each advanced field from `raw` when it is a valid value, otherwise from `fallback`, and clamps it.
export function normalizeAgentSwarmAdvancedSettings(
  raw: unknown,
  fallback: AgentSwarmAdvancedSettings = DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS
): AgentSwarmAdvancedSettings {
  const source = isRecord(raw) ? raw : {};
  const advanced = { ...fallback };
  for (const field of INTEGER_ADVANCED_FIELDS) {
    advanced[field] = clampInteger(source[field], AGENT_SWARM_ADVANCED_RANGES[field]) ?? fallback[field];
  }
  if (source.laneMaxSteps === null) {
    advanced.laneMaxSteps = null;
  } else {
    advanced.laneMaxSteps = clampInteger(source.laneMaxSteps, AGENT_SWARM_ADVANCED_RANGES.laneMaxSteps) ?? fallback.laneMaxSteps;
  }
  if (typeof source.autoCheck === "boolean") {
    advanced.autoCheck = source.autoCheck;
  }
  return advanced;
}

// Budgets apply only when switched on; a budgeted swarm without a token figure gets the default.
export function normalizeAgentSwarmSettings(raw: unknown): AgentSwarmSettings {
  const source = isRecord(raw) ? raw : {};
  const budgetsEnabled = source.budgetsEnabled === true;
  return {
    leaderAgentId: normalizeId(source.leaderAgentId),
    routerId: normalizeId(source.routerId),
    spawnEffort: normalizeAgentSwarmSpawnEffort(source.spawnEffort),
    budgetsEnabled,
    tokenBudget: budgetsEnabled
      ? normalizeAgentSwarmTokenBudget(source.tokenBudget) ?? AGENT_SWARM_DEFAULT_TOKEN_BUDGET
      : null,
    timeBudgetMinutes: budgetsEnabled ? normalizeAgentSwarmTimeBudgetMinutes(source.timeBudgetMinutes) : null,
    advanced: normalizeAgentSwarmAdvancedSettings(source.advanced)
  };
}
