import {
  AGENT_SWARM_ADVANCED_RANGES,
  DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS,
  type AgentSwarmAdvancedSettings
} from "@meowbert/shared/agent-swarm-config";

// The Agent Swarm advanced settings as form fields, shared by the composer and the admin preset editor.

export type AgentSwarmAdvancedNumberKey = Exclude<keyof AgentSwarmAdvancedSettings, "autoCheck">;

export interface AgentSwarmAdvancedFieldDef {
  key: AgentSwarmAdvancedNumberKey;
  label: string;
  // Only lane step limit can be left empty, which inherits the task's own step limit.
  nullable?: boolean;
  budgetsOnly?: boolean;
}

export const AGENT_SWARM_ADVANCED_FIELDS: AgentSwarmAdvancedFieldDef[] = [
  { key: "maxLanesPerParent", label: "Lanes per parent" },
  { key: "maxDepth", label: "Lane depth" },
  { key: "maxRunningLanes", label: "Lanes running at once" },
  { key: "laneMaxSteps", label: "Steps per lane run", nullable: true },
  { key: "reconNudgeSteps", label: "Solo steps before the split nudge (0 = off)" },
  { key: "forkCompactionThresholdTokens", label: "Compact forks above (tokens)" },
  { key: "laneSummaryMaxTokens", label: "Lane summary limit (tokens)" },
  { key: "assemblyHintTokens", label: "Suggest assembly above (tokens)" },
  { key: "dormantLaneTurns", label: "Turns a lane stays resumable (0 = off)" },
  { key: "budgetReservePercent", label: "Budget reserve (%)", budgetsOnly: true },
  { key: "laneWrapUpPercent", label: "Lane wrap-up at (% of share)", budgetsOnly: true }
];

// Text inputs keep what the user typed until it is applied.
export type AgentSwarmAdvancedDraft = Record<AgentSwarmAdvancedNumberKey, string> & { autoCheck: boolean };

export function formatAgentSwarmAdvancedDraft(
  advanced: AgentSwarmAdvancedSettings | undefined = DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS
): AgentSwarmAdvancedDraft {
  const draft = { autoCheck: advanced.autoCheck } as AgentSwarmAdvancedDraft;
  for (const field of AGENT_SWARM_ADVANCED_FIELDS) {
    const value = advanced[field.key];
    draft[field.key] = value === null ? "" : String(value);
  }
  return draft;
}

export function parseAgentSwarmAdvancedDraft(
  draft: AgentSwarmAdvancedDraft
): { advanced: AgentSwarmAdvancedSettings; error: null } | { advanced: null; error: string } {
  const advanced = { ...DEFAULT_AGENT_SWARM_ADVANCED_SETTINGS, autoCheck: draft.autoCheck };
  for (const field of AGENT_SWARM_ADVANCED_FIELDS) {
    const raw = draft[field.key].trim();
    const range = AGENT_SWARM_ADVANCED_RANGES[field.key];
    if (!raw && field.nullable) {
      advanced.laneMaxSteps = null;
      continue;
    }
    const value = Number(raw);
    if (!raw || !Number.isInteger(value) || value < range.min || value > range.max) {
      return {
        advanced: null,
        error: `${field.label} must be a whole number from ${range.min.toLocaleString()} to ${range.max.toLocaleString()}${field.nullable ? ", or empty" : ""}.`
      };
    }
    advanced[field.key] = value;
  }
  return { advanced, error: null };
}
