import {
  AGENT_SWARM_ADVANCED_RANGES,
  AGENT_SWARM_MAX_TIME_BUDGET_MINUTES,
  AGENT_SWARM_MAX_TOKEN_BUDGET,
  normalizeAgentSwarmAdvancedSettings,
  type AgentSwarmAdvancedSettings
} from "@meowbert/shared/agent-swarm-config";
import { apiBaseUrl } from "../../../lib/api";
import type { AdminRuntimeMigrationSummary } from "./shared";

export type NewsletterBodyFormat = "markdown" | "html";

interface AgentPresetDraft {
  id: string;
  name: string;
  description: string;
  requiresSuperAdmin: boolean;
  hidden?: boolean;
  payload: Record<string, unknown>;
  mode?: "standard" | "agent_swarm" | "quality_control_reviewer";
  leaderAgentId?: string;
  routerId?: string | null;
  budgetsEnabled?: boolean;
  tokenBudget?: number;
  timeBudgetMinutes?: number;
  advanced?: AgentSwarmAdvancedSettings;
}

interface ModelRouterTargetDraft {
  id: string;
  description: string;
  model: string;
  payload: Record<string, unknown>;
}

interface ModelRouterDraft {
  id: string;
  routingModel: string;
  defaultTargetModel: string;
  allowQuickMode: boolean;
  allowReasoningEffort: boolean;
  models: ModelRouterTargetDraft[];
}

export function buildEmailInboundWebhookEndpoint(secret: string): string {
  const apiOrigin = apiBaseUrl().replace(/\/+$/, "");
  const endpoint = new URL("/api/connectors/email/inbound/brevo", `${apiOrigin}/`);
  endpoint.searchParams.set("token", secret);
  return endpoint.toString();
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Continue to fallback.
    }
  }

  if (typeof document === "undefined") {
    return false;
  }

  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "absolute";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(input);
  }
}

export function buildAdminRuntimeMigrationConfirmationMessage(migration: AdminRuntimeMigrationSummary): string {
  const checklist = [
    "Queued, running, and awaiting-input tasks in affected workspaces will be cancelled automatically before the migration starts.",
    "Active shell sessions and file uploads are NOT auto-stopped. Stop them first.",
    "Make sure you have a backup before continuing."
  ];

  if (migration.key === "nest_environment_roots") {
    return [
      `Run "${migration.title}" now?`,
      "",
      migration.pendingItems > 0
        ? `${migration.pendingItems} project root${migration.pendingItems === 1 ? "" : "s"} will be moved into workspace storage units.`
        : "No pending legacy project roots were detected, but this will queue the migration again.",
      "",
      ...checklist
    ].join("\n");
  }

  return [
    `Run "${migration.title}" now?`,
    "",
    migration.pendingItems > 0
      ? `${migration.pendingItems} workspace${migration.pendingItems === 1 ? "" : "s"} will be moved onto the managed XFS path and assigned hard quotas.`
      : "No pending local workspaces were detected, but this will queue the migration again.",
    "",
    ...checklist
  ].join("\n");
}

export function parseModelMetadataDraft(raw: string): Record<string, Record<string, unknown>> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Model metadata must be a JSON object.");
  }

  const normalized: Record<string, Record<string, unknown>> = {};
  for (const [model, value] of Object.entries(parsed as Record<string, unknown>)) {
    const normalizedModel = model.trim();
    if (!normalizedModel) {
      throw new Error("Model metadata keys must be non-empty strings.");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Model metadata entry ${normalizedModel} must be an object.`);
    }
    normalized[normalizedModel] = value as Record<string, unknown>;
  }
  return normalized;
}

export function parseModelSliderAgentIdsDraft(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Model slider IDs must be a JSON array.");
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const value of parsed) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("Model slider IDs must be non-empty strings.");
    }

    const id = value.trim();
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }

  if (ids.length > 100) {
    throw new Error("Model slider supports at most 100 IDs.");
  }

  return ids;
}

export function parseSpecializedModelsDraft(raw: string): {
  internalModel: string | null;
  fastModel: string | null;
  memorySynthesisAgent: string | null;
  reviewerAgent: string | null;
  subagentFastAgent: string | null;
} {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Specialized models must be a JSON object.");
  }

  const record = parsed as Record<string, unknown>;
  const normalize = (value: unknown, label: string): string | null => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`${label} must be a non-empty string or null.`);
    }
    return value.trim();
  };

  return {
    internalModel: normalize(record.internalModel, "internalModel"),
    fastModel: normalize(record.fastModel, "fastModel"),
    memorySynthesisAgent: normalize(record.memorySynthesisAgent, "memorySynthesisAgent"),
    reviewerAgent: normalize(record.reviewerAgent, "reviewerAgent"),
    subagentFastAgent: normalize(record.subagentFastAgent, "subagentFastAgent")
  };
}

export function parseNewsletterTrialRecipients(raw: string): string[] {
  const recipients = raw
    .split(/[\n,;]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
  return Array.from(new Set(recipients));
}

export function parseAgentPresetsDraft(raw: string): AgentPresetDraft[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Agent presets cannot be empty.");
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(Array.isArray(parsed) ? "At least one agent preset is required." : "Agent presets must be a JSON array.");
  }

  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Each agent preset must be an object.");
    }

    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const description = typeof record.description === "string" ? record.description.trim() : "";
    if (typeof record.requiresSuperAdmin !== "undefined" && typeof record.requiresSuperAdmin !== "boolean") {
      throw new Error(`Agent preset ${id || "<unknown>"} requiresSuperAdmin must be a boolean when provided.`);
    }
    if (typeof record.hidden !== "undefined" && typeof record.hidden !== "boolean") {
      throw new Error(`Agent preset ${id || "<unknown>"} hidden must be a boolean when provided.`);
    }
    if (!id || !name || !description) {
      throw new Error("Each agent preset requires id, name, and description.");
    }
    if (!record.payload || typeof record.payload !== "object" || Array.isArray(record.payload)) {
      throw new Error(`Agent preset ${id} requires an object payload.`);
    }
    const mode = record.mode === undefined ? undefined : record.mode;
    if (mode !== undefined && mode !== "standard" && mode !== "agent_swarm" && mode !== "quality_control_reviewer") {
      throw new Error(`Agent preset ${id} mode must be standard, agent_swarm, or quality_control_reviewer.`);
    }
    const leaderAgentId = typeof record.leaderAgentId === "string" ? record.leaderAgentId.trim() : undefined;
    if (mode === "agent_swarm" && !leaderAgentId) {
      throw new Error(`Agent Swarm preset ${id} requires leaderAgentId.`);
    }

    return {
      id,
      name,
      description,
      requiresSuperAdmin: record.requiresSuperAdmin === true,
      ...(record.hidden === true ? { hidden: true } : {}),
      payload: record.payload as Record<string, unknown>,
      ...(mode ? { mode } : {}),
      ...(leaderAgentId ? { leaderAgentId } : {}),
      ...parseSwarmFields(id, record)
    };
  });
}

// Mirrors the admin preset schema on the API, so a bad swarm field fails here before saving.
function parseSwarmFields(id: string, record: Record<string, unknown>): Pick<
  AgentPresetDraft,
  "routerId" | "budgetsEnabled" | "tokenBudget" | "timeBudgetMinutes" | "advanced"
> {
  const budgetMaxima = { tokenBudget: AGENT_SWARM_MAX_TOKEN_BUDGET, timeBudgetMinutes: AGENT_SWARM_MAX_TIME_BUDGET_MINUTES };
  for (const key of ["tokenBudget", "timeBudgetMinutes"] as const) {
    const value = record[key];
    if (value !== undefined && (!isWholeNumber(value) || value <= 0 || value > budgetMaxima[key])) {
      throw new Error(`Agent preset ${id} ${key} must be a whole number from 1 to ${budgetMaxima[key]} when provided.`);
    }
  }
  if (record.routerId !== undefined && record.routerId !== null && typeof record.routerId !== "string") {
    throw new Error(`Agent preset ${id} routerId must be a string or null when provided.`);
  }
  if (record.budgetsEnabled !== undefined && typeof record.budgetsEnabled !== "boolean") {
    throw new Error(`Agent preset ${id} budgetsEnabled must be a boolean when provided.`);
  }
  const routerId = typeof record.routerId === "string" ? record.routerId.trim() || null : record.routerId;
  return {
    ...(routerId !== undefined ? { routerId } : {}),
    ...(typeof record.budgetsEnabled === "boolean" ? { budgetsEnabled: record.budgetsEnabled } : {}),
    ...(typeof record.tokenBudget === "number" ? { tokenBudget: record.tokenBudget } : {}),
    ...(typeof record.timeBudgetMinutes === "number" ? { timeBudgetMinutes: record.timeBudgetMinutes } : {}),
    ...(record.advanced !== undefined ? { advanced: parseSwarmAdvanced(id, record.advanced) } : {})
  };
}

function isWholeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function parseSwarmAdvanced(id: string, raw: unknown): AgentSwarmAdvancedSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Agent preset ${id} advanced must be an object.`);
  }
  const advanced = raw as Record<string, unknown>;
  for (const [key, value] of Object.entries(advanced)) {
    if (key === "autoCheck") {
      if (typeof value !== "boolean") {
        throw new Error(`Agent preset ${id} advanced.autoCheck must be a boolean.`);
      }
      continue;
    }
    const range = AGENT_SWARM_ADVANCED_RANGES[key as keyof typeof AGENT_SWARM_ADVANCED_RANGES];
    if (!range) {
      throw new Error(`Agent preset ${id} has unknown advanced field ${key}.`);
    }
    if (key === "laneMaxSteps" && value === null) {
      continue;
    }
    if (!isWholeNumber(value) || value < range.min || value > range.max) {
      throw new Error(`Agent preset ${id} advanced.${key} must be a whole number from ${range.min} to ${range.max}.`);
    }
  }
  return normalizeAgentSwarmAdvancedSettings(advanced);
}

export function parseModelRoutersDraft(raw: string): ModelRouterDraft[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Model routers must be a JSON array.");
  }

  return parsed.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Each model router must be an object.");
    }

    const record = entry as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const routingModel = typeof record.routingModel === "string" ? record.routingModel.trim() : "";
    const defaultTargetModel = typeof record.defaultTargetModel === "string" ? record.defaultTargetModel.trim() : "";
    if (!id || !routingModel || !defaultTargetModel) {
      throw new Error("Each model router requires id, routingModel, and defaultTargetModel.");
    }
    if (!Array.isArray(record.models) || record.models.length === 0) {
      throw new Error(`Model router ${id} requires a non-empty models array.`);
    }

    const models = record.models.map((rawModel) => {
      if (!rawModel || typeof rawModel !== "object" || Array.isArray(rawModel)) {
        throw new Error(`Each model router target in ${id} must be an object.`);
      }

      const target = rawModel as Record<string, unknown>;
      const targetId = typeof target.id === "string" ? target.id.trim() : "";
      const description = typeof target.description === "string" ? target.description.trim() : "";
      if (!targetId || !description) {
        throw new Error(`Each model router target in ${id} requires id and description.`);
      }
      const model = typeof target.model === "string" ? target.model.trim() : "";
      if (!model) {
        throw new Error(`Model router target ${targetId} in ${id} requires model.`);
      }
      if (target.payload !== undefined && (!target.payload || typeof target.payload !== "object" || Array.isArray(target.payload))) {
        throw new Error(`Model router target ${targetId} in ${id} has a payload that is not an object.`);
      }
      const payload = (target.payload ?? {}) as Record<string, unknown>;
      if ("model" in payload) {
        throw new Error(`Model router target ${targetId} in ${id} sets model inside payload. Move it to the target's model field.`);
      }

      return { id: targetId, description, model, payload };
    });

    return {
      id,
      routingModel,
      defaultTargetModel,
      allowQuickMode: record.allowQuickMode === true,
      allowReasoningEffort: record.allowReasoningEffort === true,
      models
    };
  });
}
