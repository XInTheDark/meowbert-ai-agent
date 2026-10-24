import {
  AGENT_SWARM_MAX_TIME_BUDGET_MINUTES,
  AGENT_SWARM_MAX_TOKEN_BUDGET,
  DEFAULT_AGENT_SWARM_SPAWN_EFFORT,
  normalizeAgentSwarmSpawnEffort,
  normalizeAgentSwarmAdvancedSettings
} from "@meowbert/shared/agent-swarm-config";
import {
  formatAgentSwarmAdvancedDraft,
  parseAgentSwarmAdvancedDraft,
  type AgentSwarmAdvancedDraft
} from "../../../task/agentSwarmAdvancedFields";

// The Agent Swarm preset editor works on the agent presets JSON draft: it reads swarm presets out of
// it as plain fields and writes an edited one back, so the JSON stays the one source of truth.

export interface SwarmPresetForm {
  id: string;
  name: string;
  description: string;
  leaderAgentId: string;
  routerId: string;
  spawnEffort: number;
  budgetsEnabled: boolean;
  tokenBudget: string;
  timeBudgetMinutes: string;
  advanced: AgentSwarmAdvancedDraft;
}

type PresetRecord = Record<string, unknown>;

function readPresetRecords(presetsJson: string): PresetRecord[] | null {
  try {
    const parsed = JSON.parse(presetsJson.trim() || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is PresetRecord => typeof entry === "object" && entry !== null) : null;
  } catch {
    return null;
  }
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const numberText = (value: unknown): string => (typeof value === "number" ? String(value) : "");

export function buildEmptySwarmPresetForm(): SwarmPresetForm {
  return {
    id: "", name: "", description: "", leaderAgentId: "", routerId: "", spawnEffort: DEFAULT_AGENT_SWARM_SPAWN_EFFORT, budgetsEnabled: false,
    tokenBudget: "", timeBudgetMinutes: "", advanced: formatAgentSwarmAdvancedDraft()
  };
}

export function listSwarmPresetForms(presetsJson: string): SwarmPresetForm[] {
  return (readPresetRecords(presetsJson) ?? [])
    .filter((record) => record.mode === "agent_swarm")
    .map((record) => ({
      id: text(record.id),
      name: text(record.name),
      description: text(record.description),
      leaderAgentId: text(record.leaderAgentId),
      routerId: text(record.routerId),
      spawnEffort: normalizeAgentSwarmSpawnEffort(record.spawnEffort),
      budgetsEnabled: record.budgetsEnabled === true,
      tokenBudget: numberText(record.tokenBudget),
      timeBudgetMinutes: numberText(record.timeBudgetMinutes),
      advanced: formatAgentSwarmAdvancedDraft(normalizeAgentSwarmAdvancedSettings(record.advanced))
    }));
}

// A leader must be a single agent, never another swarm or a reviewer preset.
export function listLeaderOptions(presetsJson: string): Array<{ id: string; name: string }> {
  return (readPresetRecords(presetsJson) ?? [])
    .filter((record) => (record.mode ?? "standard") === "standard" && typeof record.id === "string")
    .map((record) => ({ id: record.id as string, name: text(record.name) || (record.id as string) }));
}

export function listRouterIds(routersJson: string): string[] {
  return (readPresetRecords(routersJson) ?? []).flatMap((router) => typeof router.id === "string" ? [router.id] : []);
}

function parseBudget(raw: string, max: number, label: string): number | null | string {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value > 0 && value <= max ? value : `${label} must be a whole number from 1 to ${max.toLocaleString()}.`;
}

function buildPresetRecord(form: SwarmPresetForm, existing: PresetRecord | undefined): PresetRecord | string {
  if (!form.id.trim()) return "Give the preset an ID.";
  if (!form.leaderAgentId) return "Pick a leader agent.";
  const tokenBudget = parseBudget(form.tokenBudget, AGENT_SWARM_MAX_TOKEN_BUDGET, "Token budget");
  if (typeof tokenBudget === "string") return tokenBudget;
  const timeBudgetMinutes = parseBudget(form.timeBudgetMinutes, AGENT_SWARM_MAX_TIME_BUDGET_MINUTES, "Time budget");
  if (typeof timeBudgetMinutes === "string") return timeBudgetMinutes;
  const advanced = parseAgentSwarmAdvancedDraft(form.advanced);
  if (advanced.error !== null) return advanced.error;
  const { tokenBudget: _token, timeBudgetMinutes: _time, ...kept } = existing ?? {};
  return {
    requiresSuperAdmin: false,
    payload: {},
    ...kept,
    id: form.id.trim().toLowerCase(),
    name: form.name.trim() || form.id.trim(),
    description: form.description.trim(),
    mode: "agent_swarm",
    leaderAgentId: form.leaderAgentId,
    routerId: form.routerId || null,
    spawnEffort: normalizeAgentSwarmSpawnEffort(form.spawnEffort),
    budgetsEnabled: form.budgetsEnabled,
    ...(tokenBudget !== null ? { tokenBudget } : {}),
    ...(timeBudgetMinutes !== null ? { timeBudgetMinutes } : {}),
    advanced: advanced.advanced
  };
}

// Replaces the preset that had `originalId` (or adds a new one) and returns the updated JSON draft.
export function applySwarmPresetForm(
  presetsJson: string,
  form: SwarmPresetForm,
  originalId: string | null
): { json: string; error: null } | { json: null; error: string } {
  const records = readPresetRecords(presetsJson);
  if (!records) return { json: null, error: "Fix the agent presets JSON first." };
  const index = originalId ? records.findIndex((record) => record.id === originalId) : -1;
  const record = buildPresetRecord(form, index >= 0 ? records[index] : undefined);
  if (typeof record === "string") return { json: null, error: record };
  if (records.some((candidate, candidateIndex) => candidateIndex !== index && candidate.id === record.id)) {
    return { json: null, error: `Another preset already uses the ID ${String(record.id)}.` };
  }
  const next = [...records];
  if (index >= 0) next[index] = record;
  else next.push(record);
  return { json: JSON.stringify(next, null, 2), error: null };
}
