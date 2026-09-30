import {
  buildProjectContextPath as buildSharedProjectContextPath,
  getProjectContextNotes as getSharedProjectContextNotes,
  removeProjectContextNotes as removeSharedProjectContextNotes,
  setProjectContextNote as setSharedProjectContextNote,
  normalizeProjectContextPath as normalizeSharedProjectContextPath
} from "@meowbert/shared/project-context";
import {
  getSandboxNetworkEnabled as getSharedSandboxNetworkEnabled,
  setSandboxNetworkEnabled as setSharedSandboxNetworkEnabled
} from "@meowbert/shared/sandbox";
import {
  getPersistentRuntimeEnabled as getSharedPersistentRuntimeEnabled,
  getSandboxNetworkEnabledOverride as getSharedSandboxNetworkEnabledOverride,
  setPersistentRuntimeEnabled as setSharedPersistentRuntimeEnabled,
  setSandboxNetworkEnabledOverride as setSharedSandboxNetworkEnabledOverride
} from "@meowbert/shared/workspace-agent-settings";
import { createDefaultEnvironmentJsonPayload, normalizeEnvironmentResponsesSettings } from "@meowbert/shared/responses-settings";
import { apiBaseUrl } from "./api";
import { TaskMessage, Environment, TaskAttachment, type TaskType, type TaskWorkflowOverview } from "./types";

export const DEFAULT_ENVIRONMENT_JSON_PAYLOAD: Record<string, unknown> = createDefaultEnvironmentJsonPayload();
const DEFAULT_ENVIRONMENT_PERSONALITY_FALLBACK_ID = "default";
export const TASK_CLEANUP_EXPIRATION_DAYS_MIN = 1;
export const TASK_CLEANUP_EXPIRATION_DAYS_MAX = 3650;

function stripUnsupportedEnvironmentJsonKeys(payload: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...payload };
  delete normalized.max_context_window_tokens;
  return normalized;
}

export function normalizeEnvironmentJsonPayload(payload: Record<string, unknown>): Record<string, unknown> {
  let normalized = stripUnsupportedEnvironmentJsonKeys(payload);
  normalized = normalizeEnvironmentResponsesSettings(normalized);

  const cleanupExpirationDays = getTaskCleanupExpirationDays(normalized);
  const contextNotes = getSharedProjectContextNotes(normalized);
  normalized = setTaskCleanupExpirationDays(normalized, cleanupExpirationDays);
  normalized = setSandboxNetworkEnabledOverride(normalized, getSandboxNetworkEnabledOverride(normalized));
  normalized = setNetworkRequestLoggingEnabled(normalized, getNetworkRequestLoggingEnabled(normalized));
  if (Object.prototype.hasOwnProperty.call(normalized, "persistent_runtime")) {
    normalized = setPersistentRuntimeEnabled(normalized, getPersistentRuntimeEnabled(normalized));
  }
  normalized = removeSharedProjectContextNotes(normalized, Object.keys(contextNotes));
  for (const [relativePath, note] of Object.entries(contextNotes)) {
    normalized = setSharedProjectContextNote(normalized, relativePath, note);
  }

  return normalized;
}

function normalizePersonalityId(rawValue: unknown): string | null {
  if (typeof rawValue !== "string") {
    return null;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  return normalized;
}

function asDefaultContext(payload: Record<string, unknown>): Record<string, unknown> {
  return isPlainObject(payload.default_context) ? payload.default_context : {};
}

export function getEnvironmentSystemPromptOverride(payload: Record<string, unknown>): string {
  const systemPrompt = asDefaultContext(payload).system_prompt;
  return typeof systemPrompt === "string" ? systemPrompt : "";
}

export function setEnvironmentSystemPromptOverride(
  payload: Record<string, unknown>,
  systemPrompt: string | null
): Record<string, unknown> {
  const normalized = { ...payload };
  const existingDefaultContext = { ...asDefaultContext(normalized) };

  if (typeof systemPrompt === "string" && systemPrompt.trim().length > 0) {
    existingDefaultContext.system_prompt = systemPrompt;
  } else {
    delete existingDefaultContext.system_prompt;
  }

  if (Object.keys(existingDefaultContext).length === 0) {
    delete normalized.default_context;
  } else {
    normalized.default_context = existingDefaultContext;
  }

  return normalized;
}

export function getEnvironmentPersonalityOverrideId(
  payload: Record<string, unknown>
): string | null {
  return normalizePersonalityId(asDefaultContext(payload).personality);
}

export function getEnvironmentPersonalityId(
  payload: Record<string, unknown>,
  input: {
    availableIds: string[];
    defaultId: string | null;
  }
): string {
  const normalizedAvailableIds = input.availableIds
    .map((candidate) => normalizePersonalityId(candidate))
    .filter((candidate): candidate is string => typeof candidate === "string");
  const availableIdSet = new Set(normalizedAvailableIds);

  const configured = normalizePersonalityId(asDefaultContext(payload).personality);
  if (configured && availableIdSet.has(configured)) {
    return configured;
  }

  const normalizedDefault = normalizePersonalityId(input.defaultId) ?? DEFAULT_ENVIRONMENT_PERSONALITY_FALLBACK_ID;
  if (availableIdSet.has(normalizedDefault)) {
    return normalizedDefault;
  }

  return normalizedAvailableIds[0] ?? normalizedDefault;
}

export function setEnvironmentPersonalityId(
  payload: Record<string, unknown>,
  personalityId: string | null
): Record<string, unknown> {
  const normalized = { ...payload };
  const existingDefaultContext = { ...asDefaultContext(normalized) };
  const normalizedPersonalityId = normalizePersonalityId(personalityId);

  if (normalizedPersonalityId) {
    existingDefaultContext.personality = normalizedPersonalityId;
  } else {
    delete existingDefaultContext.personality;
  }

  if (Object.keys(existingDefaultContext).length === 0) {
    delete normalized.default_context;
  } else {
    normalized.default_context = existingDefaultContext;
  }

  return normalized;
}

function parseExpirationDays(rawValue: unknown): number | null {
  const candidateNumber = typeof rawValue === "number"
    ? rawValue
    : typeof rawValue === "string" && rawValue.trim().length > 0
      ? Number(rawValue)
      : NaN;
  if (!Number.isFinite(candidateNumber)) {
    return null;
  }

  const rounded = Math.floor(candidateNumber);
  if (rounded < TASK_CLEANUP_EXPIRATION_DAYS_MIN || rounded > TASK_CLEANUP_EXPIRATION_DAYS_MAX) {
    return null;
  }

  return rounded;
}

export function getTaskCleanupExpirationDays(payload: Record<string, unknown>): number | null {
  const taskCleanup = payload.task_cleanup;
  if (!isPlainObject(taskCleanup)) {
    return null;
  }

  return parseExpirationDays(taskCleanup.expiration_days ?? taskCleanup.expirationDays);
}

export function setTaskCleanupExpirationDays(
  payload: Record<string, unknown>,
  expirationDays: number | null
): Record<string, unknown> {
  const normalized = { ...payload };
  const existingTaskCleanup = isPlainObject(normalized.task_cleanup)
    ? { ...normalized.task_cleanup }
    : {};

  if (expirationDays === null) {
    delete existingTaskCleanup.expiration_days;
    delete existingTaskCleanup.expirationDays;
    if (Object.keys(existingTaskCleanup).length === 0) {
      delete normalized.task_cleanup;
    } else {
      normalized.task_cleanup = existingTaskCleanup;
    }
    return normalized;
  }

  existingTaskCleanup.expiration_days = expirationDays;
  delete existingTaskCleanup.expirationDays;
  normalized.task_cleanup = existingTaskCleanup;
  return normalized;
}

export function getSandboxNetworkEnabled(payload: Record<string, unknown>): boolean {
  return getSharedSandboxNetworkEnabled(payload);
}

export function setSandboxNetworkEnabled(
  payload: Record<string, unknown>,
  enabled: boolean
): Record<string, unknown> {
  return setSharedSandboxNetworkEnabled(payload, enabled);
}

export function getSandboxNetworkEnabledOverride(
  payload: Record<string, unknown>
): boolean | null {
  return getSharedSandboxNetworkEnabledOverride(payload);
}

export function setSandboxNetworkEnabledOverride(
  payload: Record<string, unknown>,
  enabled: boolean | null
): Record<string, unknown> {
  return setSharedSandboxNetworkEnabledOverride(payload, enabled);
}

export function getNetworkRequestLoggingEnabled(payload: Record<string, unknown>): boolean {
  const debugConfig = payload.debug;
  if (!isPlainObject(debugConfig)) {
    return false;
  }

  return debugConfig.log_network_requests === true || debugConfig.logNetworkRequests === true;
}

export function setNetworkRequestLoggingEnabled(
  payload: Record<string, unknown>,
  enabled: boolean
): Record<string, unknown> {
  const normalized = { ...payload };
  const existingDebug = isPlainObject(normalized.debug)
    ? { ...normalized.debug }
    : {};

  if (enabled) {
    existingDebug.log_network_requests = true;
    delete existingDebug.logNetworkRequests;
    normalized.debug = existingDebug;
    return normalized;
  }

  delete existingDebug.log_network_requests;
  delete existingDebug.logNetworkRequests;
  if (Object.keys(existingDebug).length === 0) {
    delete normalized.debug;
  } else {
    normalized.debug = existingDebug;
  }

  return normalized;
}

export function getMessageText(message: TaskMessage): string {
  const text = message.content_json.text;
  if (typeof text === "string") {
    return text;
  }
  return JSON.stringify(message.content_json, null, 2);
}

export function formatDateTime(input: string): string {
  return new Date(input).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

export function formatRelative(input: string): string {
  const timestamp = new Date(input).getTime();
  if (Number.isNaN(timestamp)) {
    return "--";
  }

  const deltaSec = Math.round((Date.now() - timestamp) / 1000);
  const isPast = deltaSec >= 0;
  const distanceSec = Math.abs(deltaSec);

  if (distanceSec === 0) {
    return "just now";
  }

  const unit = distanceSec < 60
    ? `${distanceSec}s`
    : distanceSec < 3600
      ? `${Math.floor(distanceSec / 60)}m`
      : distanceSec < 86400
        ? `${Math.floor(distanceSec / 3600)}h`
        : `${Math.floor(distanceSec / 86400)}d`;

  if (isPast) {
    return `${unit} ago`;
  }

  return `in ${unit}`;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getEnvironmentJsonPayload(environment: Environment | null | undefined): Record<string, unknown> {
  if (!environment || !isPlainObject(environment.json_payload)) {
    return createDefaultEnvironmentJsonPayload();
  }

  return normalizeEnvironmentJsonPayload(environment.json_payload);
}

export const normalizeProjectJsonPayload = normalizeEnvironmentJsonPayload;
export const getProjectSystemPromptOverride = getEnvironmentSystemPromptOverride;
export const setProjectSystemPromptOverride = setEnvironmentSystemPromptOverride;
export const getProjectPersonalityOverrideId = getEnvironmentPersonalityOverrideId;
export const setProjectPersonalityId = setEnvironmentPersonalityId;
export const getProjectJsonPayload = getEnvironmentJsonPayload;
export const getPersistentRuntimeEnabled = getSharedPersistentRuntimeEnabled;
export const setPersistentRuntimeEnabled = setSharedPersistentRuntimeEnabled;
export const normalizeProjectContextPath = normalizeSharedProjectContextPath;
export const buildProjectContextPath = buildSharedProjectContextPath;
export const getProjectContextNotes = getSharedProjectContextNotes;
export const setProjectContextNote = setSharedProjectContextNote;
export const removeProjectContextNotes = removeSharedProjectContextNotes;

export function safeParseJson(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { text: value };
  }
}

export function badgeClass(status: string): string {
  if (status === "succeeded" || status === "active") {
    return "badge good";
  }
  if (
    status === "running"
    || status === "starting"
    || status === "queued"
    || status === "paused"
    || status === "awaiting_input"
    || status === "interrupting"
  ) {
    return "badge warning";
  }
  if (status === "failed" || status === "error") {
    return "badge danger";
  }
  return "badge muted";
}

export function getEffectiveTaskStatus(input: {
  taskStatus: string;
  cancellationRequested?: boolean;
  workflow?: TaskWorkflowOverview | null;
}): string {
  if (input.taskStatus === "cancelled" || input.taskStatus === "failed") {
    return input.taskStatus;
  }

  if (input.cancellationRequested === true) {
    return "interrupting";
  }

  const workflow = input.workflow;
  if (!workflow) {
    return input.taskStatus;
  }

  if (workflow.type === "agent_swarm") {
    if (workflow.phase !== "completed") {
      return "running";
    }

    if (workflow.agentSwarm.workers.some((worker) => worker.status === "running" || worker.status === "starting")) {
      return "running";
    }

    if (workflow.agentSwarm.workers.some((worker) => worker.status === "queued")) {
      return "queued";
    }

    if (workflow.phase !== "completed" && input.taskStatus === "succeeded") {
      return "running";
    }
  }

  return input.taskStatus;
}

export function formatTaskTypeLabel(taskType: TaskType | string): string {
  if (taskType === "long_horizon") {
    return "Long Horizon";
  }

  if (taskType === "agent_swarm") {
    return "Agent Swarm";
  }

  return taskType
    .split("_")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function joinTaskMessage(prompt: string, attachments: TaskAttachment[]): string {
  if (attachments.length === 0) {
    return prompt.trim();
  }

  const attachmentLines = attachments.map((item) => {
    const forceInclude = item.forceInclude === true ? " [force include]" : "";
    if (item.kind !== "note") {
      const fileSize = typeof item.sizeBytes === "number" ? ` (${item.sizeBytes} bytes)` : "";
      return `- ${item.kind}: ${item.relativePath ?? item.content}${fileSize}${forceInclude}`;
    }
    return `- note: ${item.content}${forceInclude}`;
  });

  return `${prompt.trim()}\n\nAttached context:\n${attachmentLines.join("\n")}`;
}

export function buildDownloadUrl(environmentId: string, relativePath: string): string {
  const url = new URL(`${apiBaseUrl()}/api/projects/${environmentId}/files/download`);
  url.searchParams.set("path", relativePath);
  return url.toString();
}

export function buildBatchDownloadUrl(
  environmentId: string,
  relativePaths: string[],
  currentDirectory?: string
): string {
  const url = new URL(`${apiBaseUrl()}/api/projects/${environmentId}/files/download/batch`);
  for (const relativePath of relativePaths) {
    url.searchParams.append("path", relativePath);
  }
  if (currentDirectory) {
    url.searchParams.set("cwd", currentDirectory);
  }
  return url.toString();
}

export function buildWorkspaceDownloadUrl(workspaceId: string, relativePath: string): string {
  const url = new URL(`${apiBaseUrl()}/api/workspaces/${workspaceId}/files/download`);
  url.searchParams.set("path", relativePath);
  return url.toString();
}

export function buildWorkspaceBatchDownloadUrl(
  workspaceId: string,
  relativePaths: string[],
  currentDirectory?: string
): string {
  const url = new URL(`${apiBaseUrl()}/api/workspaces/${workspaceId}/files/download/batch`);
  for (const relativePath of relativePaths) {
    url.searchParams.append("path", relativePath);
  }
  if (currentDirectory) {
    url.searchParams.set("cwd", currentDirectory);
  }
  return url.toString();
}

export function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || Number.isNaN(bytes)) {
    return "--";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
