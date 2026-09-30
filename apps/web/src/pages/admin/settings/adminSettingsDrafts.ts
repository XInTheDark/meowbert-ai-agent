import { apiBaseUrl } from "../../../lib/api";
import type { AdminRuntimeMigrationSummary } from "./shared";

export type NewsletterBodyFormat = "markdown" | "html";

interface AgentPresetDraft {
  id: string;
  name: string;
  description: string;
  requiresSuperAdmin: boolean;
  hidden?: boolean;
  spawnableAsNode?: boolean;
  payload: Record<string, unknown>;
  mode?: "standard" | "agent_swarm" | "quality_control_reviewer";
  leaderAgentId?: string;
  modelAllocations?: Array<{ agentId: string; workerCount: number }>;
  reviewRounds?: number;
}

interface ModelRouterTargetDraft {
  id: string;
  description: string;
  payload: Record<string, unknown>;
}

interface ModelRouterDraft {
  id: string;
  routingModel: string;
  defaultTargetModel: string;
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
    if (typeof record.spawnableAsNode !== "undefined" && typeof record.spawnableAsNode !== "boolean") {
      throw new Error(`Agent preset ${id || "<unknown>"} spawnableAsNode must be a boolean when provided.`);
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
    const modelAllocations = Array.isArray(record.modelAllocations)
      ? record.modelAllocations.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          throw new Error(`Agent preset ${id} modelAllocations entries must be objects.`);
        }
        const allocation = item as Record<string, unknown>;
        if (typeof allocation.agentId !== "string" || !Number.isInteger(allocation.workerCount)) {
          throw new Error(`Agent preset ${id} modelAllocations entries require agentId and workerCount.`);
        }
        return { agentId: allocation.agentId.trim(), workerCount: allocation.workerCount as number };
      })
      : undefined;
    if (mode === "agent_swarm" && (!leaderAgentId || !modelAllocations)) {
      throw new Error(`Agent Swarm preset ${id} requires leaderAgentId and modelAllocations.`);
    }

    return {
      id,
      name,
      description,
      requiresSuperAdmin: record.requiresSuperAdmin === true,
      ...(record.hidden === true ? { hidden: true } : {}),
      ...(typeof record.spawnableAsNode === "boolean"
        ? { spawnableAsNode: record.spawnableAsNode }
        : {}),
      payload: record.payload as Record<string, unknown>,
      ...(mode ? { mode } : {}),
      ...(leaderAgentId ? { leaderAgentId } : {}),
      ...(modelAllocations ? { modelAllocations } : {}),
      ...(typeof record.reviewRounds === "number" && Number.isInteger(record.reviewRounds)
        ? { reviewRounds: record.reviewRounds }
        : {})
    };
  });
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
      if (!target.payload || typeof target.payload !== "object" || Array.isArray(target.payload)) {
        throw new Error(`Model router target ${targetId} in ${id} requires an object payload.`);
      }
      const payload = target.payload as Record<string, unknown>;
      if (typeof payload.model !== "string" || payload.model.trim().length === 0) {
        throw new Error(`Model router target ${targetId} in ${id} requires payload.model.`);
      }

      return { id: targetId, description, payload };
    });

    return { id, routingModel, defaultTargetModel, models };
  });
}
