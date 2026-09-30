import { z } from "zod";
import {
  DEFAULT_ENVIRONMENT_PERSONALITY_ID,
  getNewMessageOrganizationEnabled,
  getProjectMasterEnabled,
  getSandboxNetworkEnabled,
  getSandboxNetworkEnabledOverride,
  getWorkspaceDefaultAgentId,
  getWorkspaceDefaultToolset,
  getWorkspaceMemorySynthesisEnabled,
  getWorkspacePersonalityId,
  getWorkspaceSuggestedActionsEnabled,
  getWorkspaceSystemPrompt,
  getWorkspaceThoughtPersistenceEnabled,
  loadPersonalityPromptCatalog,
  resolveEnvironmentPersonalityId
} from "@meowbert/shared";
import { DEFAULT_WORKSPACE_ICON_KEY, WORKSPACE_ICON_KEYS } from "@meowbert/shared/workspace-icons";
import { query } from "../../lib/db.js";

export const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(80)
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).max(80),
  iconKey: z.enum(WORKSPACE_ICON_KEYS).default(DEFAULT_WORKSPACE_ICON_KEY)
});

export const workspaceParamsSchema = z.object({
  wsId: z.string().uuid()
});

export const workspaceBootstrapQuerySchema = z.object({
  projectId: z.string().uuid().optional()
});

export const workspaceMemberParamsSchema = workspaceParamsSchema.extend({
  userId: z.string().uuid()
});

export const workspaceInviteParamsSchema = workspaceParamsSchema.extend({
  inviteId: z.string().uuid()
});

export const inviteDecisionParamsSchema = z.object({
  inviteId: z.string().uuid()
});

export const workspaceMemberCreateSchema = z.object({
  email: z.string().trim().email().max(320)
});

export const workspaceNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

const workspaceDefaultToolsetSchema = z.object({
  webSearch: z.boolean().optional(),
  memorySearch: z.boolean().optional(),
  scheduleTask: z.boolean().optional(),
  subtasks: z.boolean().optional(),
  computerUse: z.boolean().optional(),
  enabledSkills: z.array(z.string()).optional(),
  enabledSources: z.array(z.string()).optional()
});

export const workspaceSettingsPatchSchema = z
  .object({
    modelRequestTimeoutMs: z.number().int().min(1_000).max(86_400_000).nullable().optional(),
    shellToolMaxTimeoutMs: z.number().int().min(1_000).max(86_400_000).nullable().optional(),
    mcpTimeoutMs: z.number().int().min(1_000).max(86_400_000).nullable().optional(),
    newMessageOrganizationEnabled: z.boolean().optional(),
    projectMasterEnabled: z.boolean().optional(),
    defaultAgentId: z.string().trim().min(1).max(120).nullable().optional(),
    nativeCompactionEnabled: z.boolean().optional(),
    sendMetadataToModel: z.boolean().optional(),
    claudeCacheKeepalive: z.boolean().optional(),
    systemPrompt: z.string().max(100_000).nullable().optional(),
    personalityId: z.string().max(120).nullable().optional(),
    sandboxNetworkEnabled: z.boolean().nullable().optional(),
    defaultToolset: workspaceDefaultToolsetSchema.optional(),
    memoryEnabled: z.boolean().optional(),
    thoughtPersistenceEnabled: z.boolean().optional(),
    memorySynthesisEnabled: z.boolean().optional(),
    suggestedActionsEnabled: z.boolean().optional(),
    runAsRoot: z.boolean().optional()
  })
  .refine(
    (value) =>
      value.modelRequestTimeoutMs !== undefined
      || value.shellToolMaxTimeoutMs !== undefined
      || value.mcpTimeoutMs !== undefined
      || value.newMessageOrganizationEnabled !== undefined
      || value.projectMasterEnabled !== undefined
      || value.defaultAgentId !== undefined
      || value.nativeCompactionEnabled !== undefined
      || value.sendMetadataToModel !== undefined
      || value.claudeCacheKeepalive !== undefined
      || value.systemPrompt !== undefined
      || value.personalityId !== undefined
      || value.sandboxNetworkEnabled !== undefined
      || value.defaultToolset !== undefined
      || value.memoryEnabled !== undefined
      || value.thoughtPersistenceEnabled !== undefined
      || value.memorySynthesisEnabled !== undefined
      || value.suggestedActionsEnabled !== undefined
      || value.runAsRoot !== undefined,
    { message: "At least one settings field is required." }
  );

const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_SHELL_TOOL_MAX_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_MCP_TIMEOUT_MS = 60 * 1_000;
const PERSONALITY_CATALOG = loadPersonalityPromptCatalog();

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const floored = Math.floor(value);
    return floored > 0 ? floored : null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
      return null;
    }

    return parsed;
  }

  return null;
}

function resolveWorkspaceConfiguredRequestTimeoutMs(modelDefaults: Record<string, unknown>): number | null {
  const timeoutMsCandidate =
    parsePositiveInteger(modelDefaults.modelRequestTimeoutMs)
    ?? parsePositiveInteger(modelDefaults.hardTimeoutMs);
  if (typeof timeoutMsCandidate === "number") {
    return timeoutMsCandidate;
  }

  const timeoutSecondsCandidate =
    parsePositiveInteger(modelDefaults.modelRequestTimeoutSeconds)
    ?? parsePositiveInteger(modelDefaults.hardTimeoutSeconds);
  if (typeof timeoutSecondsCandidate === "number") {
    return timeoutSecondsCandidate * 1_000;
  }

  return null;
}

function resolveWorkspaceConfiguredShellToolMaxTimeoutMs(
  modelDefaults: Record<string, unknown>
): number | null {
  const timeoutMsCandidate = parsePositiveInteger(modelDefaults.shellToolMaxTimeoutMs);
  if (typeof timeoutMsCandidate === "number") {
    return timeoutMsCandidate;
  }

  const timeoutSecondsCandidate = parsePositiveInteger(modelDefaults.shellToolMaxTimeoutSeconds);
  if (typeof timeoutSecondsCandidate === "number") {
    return timeoutSecondsCandidate * 1_000;
  }

  return null;
}

function resolveWorkspaceConfiguredMcpTimeoutMs(modelDefaults: Record<string, unknown>): number | null {
  const timeoutMsCandidate = parsePositiveInteger(modelDefaults.mcpTimeoutMs);
  if (typeof timeoutMsCandidate === "number") {
    return timeoutMsCandidate;
  }

  const timeoutSecondsCandidate = parsePositiveInteger(modelDefaults.mcpTimeoutSeconds);
  if (typeof timeoutSecondsCandidate === "number") {
    return timeoutSecondsCandidate * 1_000;
  }

  return null;
}

function resolveWorkspaceCompactionBackend(
  modelDefaults: Record<string, unknown>
): "summary" | "native" {
  if (modelDefaults.nativeCompaction === false) {
    return "summary";
  }

  const configuredBackend = modelDefaults.contextCompactionBackend;
  if (typeof configuredBackend === "string") {
    const trimmed = configuredBackend.trim().toLowerCase();
    if (trimmed === "summary") {
      return "summary";
    }
    if (trimmed === "native") {
      return "native";
    }
  }

  if (modelDefaults.nativeCompaction === true) {
    return "native";
  }

  return "native";
}

function resolveWorkspaceClaudeCacheKeepalive(modelDefaults: Record<string, unknown>): boolean {
  return modelDefaults.claudeCacheKeepalive !== false;
}

function resolveWorkspaceSendMetadataToModel(modelDefaults: Record<string, unknown>): boolean {
  return modelDefaults.sendMetadataToModel === true;
}

export function formatWorkspaceSettingsResponse(
  modelDefaults: Record<string, unknown>,
  memoryEnabled: boolean,
  runAsRoot: boolean
): {
  modelDefaults: Record<string, unknown>;
  modelRequestTimeoutMs: number | null;
  effectiveModelRequestTimeoutMs: number;
  shellToolMaxTimeoutMs: number | null;
  effectiveShellToolMaxTimeoutMs: number;
  mcpTimeoutMs: number | null;
  effectiveMcpTimeoutMs: number;
  contextCompactionBackend: "summary" | "native";
  newMessageOrganizationEnabled: boolean;
  projectMasterEnabled: boolean;
  defaultAgentId: string | null;
  nativeCompactionEnabled: boolean;
  sendMetadataToModel: boolean;
  claudeCacheKeepalive: boolean;
  systemPrompt: string;
  personalityId: string | null;
  effectivePersonalityId: string | null;
  sandboxNetworkEnabled: boolean | null;
  effectiveSandboxNetworkEnabled: boolean;
  defaultToolset: ReturnType<typeof getWorkspaceDefaultToolset>;
  memoryEnabled: boolean;
  thoughtPersistenceEnabled: boolean;
  memorySynthesisEnabled: boolean;
  suggestedActionsEnabled: boolean;
  runAsRoot: boolean;
} {
  const modelRequestTimeoutMs = resolveWorkspaceConfiguredRequestTimeoutMs(modelDefaults);
  const shellToolMaxTimeoutMs = resolveWorkspaceConfiguredShellToolMaxTimeoutMs(modelDefaults);
  const mcpTimeoutMs = resolveWorkspaceConfiguredMcpTimeoutMs(modelDefaults);
  const contextCompactionBackend = resolveWorkspaceCompactionBackend(modelDefaults);
  const personalityId = getWorkspacePersonalityId(modelDefaults);

  return {
    modelDefaults,
    modelRequestTimeoutMs,
    effectiveModelRequestTimeoutMs: modelRequestTimeoutMs ?? DEFAULT_MODEL_REQUEST_TIMEOUT_MS,
    shellToolMaxTimeoutMs,
    effectiveShellToolMaxTimeoutMs: shellToolMaxTimeoutMs ?? DEFAULT_SHELL_TOOL_MAX_TIMEOUT_MS,
    mcpTimeoutMs,
    effectiveMcpTimeoutMs: mcpTimeoutMs ?? DEFAULT_MCP_TIMEOUT_MS,
    contextCompactionBackend,
    newMessageOrganizationEnabled: getNewMessageOrganizationEnabled(modelDefaults),
    projectMasterEnabled: getProjectMasterEnabled(modelDefaults),
    defaultAgentId: getWorkspaceDefaultAgentId(modelDefaults),
    nativeCompactionEnabled: contextCompactionBackend === "native",
    sendMetadataToModel: resolveWorkspaceSendMetadataToModel(modelDefaults),
    claudeCacheKeepalive: resolveWorkspaceClaudeCacheKeepalive(modelDefaults),
    systemPrompt: getWorkspaceSystemPrompt(modelDefaults),
    personalityId,
    effectivePersonalityId: resolveEnvironmentPersonalityId({
      requestedId: personalityId,
      catalog: PERSONALITY_CATALOG,
      defaultId: DEFAULT_ENVIRONMENT_PERSONALITY_ID
    }),
    sandboxNetworkEnabled: getSandboxNetworkEnabledOverride(modelDefaults),
    effectiveSandboxNetworkEnabled: getSandboxNetworkEnabled(modelDefaults),
    defaultToolset: getWorkspaceDefaultToolset(modelDefaults),
    memoryEnabled,
    thoughtPersistenceEnabled: getWorkspaceThoughtPersistenceEnabled(modelDefaults),
    memorySynthesisEnabled: getWorkspaceMemorySynthesisEnabled(modelDefaults),
    suggestedActionsEnabled: getWorkspaceSuggestedActionsEnabled(modelDefaults),
    runAsRoot
  };
}

export class WorkspaceLimitReachedError extends Error {
  constructor() {
    super("Workspace limit reached. Ask an admin to increase your limit.");
  }
}

export interface WorkspaceListRow {
  id: string;
  name: string;
  icon_key: string;
  role: "owner" | "member";
  joined_at: string;
  created_at: string;
  updated_at: string;
  owner_id: string | null;
  owner_email: string | null;
  owner_display_name: string | null;
  member_count: number;
  environment_count: number;
  pending_invite_count: number;
}

export function createWorkspaceSlug(name: string): string {
  const normalizedName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${normalizedName}-${Math.floor(Math.random() * 100000)}`;
}

export async function isWorkspaceOwner(wsId: string, userId: string): Promise<boolean> {
  const memberRes = await query<{ role: string }>(
    `SELECT role
       FROM workspace_members
      WHERE workspace_id = $1
        AND user_id = $2`,
    [wsId, userId]
  );

  return memberRes.rows[0]?.role === "owner";
}
