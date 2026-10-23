import {
  normalizeAgentSwarmSettings,
  type AgentSwarmAdvancedSettings,
  type AgentSwarmSettings
} from "@meowbert/shared";

// The swarm parameters a task request (composer, task settings) can carry. Missing fields fall back
// to the preset; null is an explicit value.
export interface AgentSwarmWorkflowRequest {
  routerId?: string | null;
  budgetsEnabled?: boolean;
  tokenBudget?: number | null;
  timeBudgetMinutes?: number | null;
  advanced?: Partial<AgentSwarmAdvancedSettings> | null;
}

// Where defaults come from: a swarm preset, or the settings an existing swarm task already has.
export interface AgentSwarmSettingsDefaults {
  leaderAgentId?: string | null;
  routerId?: string | null;
  budgetsEnabled?: boolean;
  tokenBudget?: number | null;
  timeBudgetMinutes?: number | null;
  advanced?: Partial<AgentSwarmAdvancedSettings>;
}

function definedEntries<T extends object>(value: T | null | undefined): Partial<T> {
  if (!value) {
    return {};
  }
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function pick(
  request: AgentSwarmWorkflowRequest,
  defaults: AgentSwarmSettingsDefaults | null,
  key: Exclude<keyof AgentSwarmWorkflowRequest, "advanced">
): unknown {
  return request[key] !== undefined ? request[key] : defaults?.[key];
}

// Request values override the preset field by field; anything still missing takes the default,
// and everything is clamped. The result is frozen on the swarm row for the life of the task.
export function resolveAgentSwarmSettings(
  requestWorkflow: AgentSwarmWorkflowRequest | null | undefined,
  preset: AgentSwarmSettingsDefaults | null
): AgentSwarmSettings {
  const request = requestWorkflow ?? {};
  return normalizeAgentSwarmSettings({
    leaderAgentId: preset?.leaderAgentId ?? null,
    routerId: pick(request, preset, "routerId"),
    budgetsEnabled: pick(request, preset, "budgetsEnabled"),
    tokenBudget: pick(request, preset, "tokenBudget"),
    timeBudgetMinutes: pick(request, preset, "timeBudgetMinutes"),
    advanced: { ...definedEntries(preset?.advanced), ...definedEntries(request.advanced) }
  });
}
