export const WORKSPACE_MEMORY_DIRNAME = ".memory";
export const WORKSPACE_MEMORY_MAIN_FILENAME = "MEMORY.md";
export const WORKSPACE_MEMORY_THINKING_FILENAME = ".thinking";
export const PROJECT_MEMORY_PARENT_DIRNAME = "projects";
export const PROJECT_MEMORY_ACTIONS_FILENAME = "actions.json";
export const WORKSPACE_MEMORY_INDEX_DIR = ".meowbert/memory-index";
export const DEFAULT_MEMORY_ENABLED = true;
export const DEFAULT_THOUGHT_PERSISTENCE_ENABLED = true;
export const DEFAULT_MEMORY_SYNTHESIS_ENABLED = false;
export const DEFAULT_SUGGESTED_ACTIONS_ENABLED = true;

export interface ProjectSuggestedAction {
  id?: string;
  label: string;
  prompt: string;
  icon?: string;
}

export function createDefaultWorkspaceMemoryMainFileContent(): string {
  return [
    "# MEMORY",
    "",
    "Use this file for the most important, frequently reused workspace knowledge.",
    "Keep it concise and current. Put deeper detail in other `.memory` files, then link or summarize it here.",
    "",
    "## Good things to keep here",
    "- Project/workspace overview",
    "- Key commands and workflows",
    "- Important conventions or preferences",
    "- Recurring gotchas or sharp edges",
    "- Active decisions that future runs should know",
    "- Canonical paths, files, or references",
    "",
    "## Notes",
    "- Update this file whenever you learn something high-value and durable.",
    "- Prefer short bullets over long prose.",
    "- If details get long, move them into another file under `.memory` and leave a short summary here."
  ].join("\n");
}

export function createDefaultProjectMemoryMainFileContent(projectName?: string | null): string {
  const normalizedProjectName = typeof projectName === "string" && projectName.trim().length > 0
    ? projectName.trim()
    : "this project";

  return [
    "# PROJECT MEMORY",
    "",
    `Use this file for durable knowledge that applies specifically to ${normalizedProjectName}.`,
    "Keep workspace-wide facts in the root `.memory/MEMORY.md`; keep project-specific plans, decisions, next steps, and gotchas here.",
    "",
    "## Good things to keep here",
    "- Project-specific goals, decisions, and constraints",
    "- Active next steps or follow-up tasks",
    "- Project-local commands, files, and workflows",
    "- Bugs, risks, or implementation notes that future runs in this project should know",
    "",
    "## Notes",
    "- Update this file when project-specific context changes.",
    "- Put longer detail in nearby project memory files and link or summarize it here."
  ].join("\n");
}

export const MAX_PROJECT_SUGGESTED_ACTIONS = 8;

export function createDefaultProjectSuggestedActions(): ProjectSuggestedAction[] {
  return [];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getWorkspaceMemoryEnabled(payload: Record<string, unknown> | null | undefined): boolean {
  if (!isPlainObject(payload)) {
    return DEFAULT_MEMORY_ENABLED;
  }

  if (payload.memoryEnabled === false || payload.memory_enabled === false) {
    return false;
  }

  if (payload.memoryEnabled === true || payload.memory_enabled === true) {
    return true;
  }

  return DEFAULT_MEMORY_ENABLED;
}

export function setWorkspaceMemoryEnabled(
  payload: Record<string, unknown>,
  enabled: boolean
): Record<string, unknown> {
  const normalized = { ...payload };

  normalized.memoryEnabled = enabled;
  delete normalized.memory_enabled;
  return normalized;
}

export function getWorkspaceThoughtPersistenceEnabled(
  payload: Record<string, unknown> | null | undefined
): boolean {
  if (!isPlainObject(payload)) {
    return DEFAULT_THOUGHT_PERSISTENCE_ENABLED;
  }

  if (payload.thoughtPersistenceEnabled === false) {
    return false;
  }

  if (payload.thoughtPersistenceEnabled === true) {
    return true;
  }

  return DEFAULT_THOUGHT_PERSISTENCE_ENABLED;
}

export function setWorkspaceThoughtPersistenceEnabled(
  payload: Record<string, unknown>,
  enabled: boolean
): Record<string, unknown> {
  return {
    ...payload,
    thoughtPersistenceEnabled: enabled
  };
}

export function getWorkspaceMemorySynthesisEnabled(payload: Record<string, unknown> | null | undefined): boolean {
  return isPlainObject(payload) && payload.memorySynthesisEnabled === true;
}

export function getProjectMemorySynthesisEnabled(payload: Record<string, unknown> | null | undefined): boolean {
  return !isPlainObject(payload) || payload.memorySynthesisEnabled !== false;
}

export function setProjectMemorySynthesisEnabled(
  payload: Record<string, unknown>,
  enabled: boolean
): Record<string, unknown> {
  return {
    ...payload,
    memorySynthesisEnabled: enabled
  };
}

export function setWorkspaceMemorySynthesisEnabled(
  payload: Record<string, unknown>,
  enabled: boolean
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...payload, memorySynthesisEnabled: enabled };
  delete next.memorySynthesisMessageThreshold;
  return next;
}

export function getWorkspaceSuggestedActionsEnabled(payload: Record<string, unknown> | null | undefined): boolean {
  if (!isPlainObject(payload)) {
    return DEFAULT_SUGGESTED_ACTIONS_ENABLED;
  }

  if (payload.suggestedActionsEnabled === false) {
    return false;
  }

  if (payload.suggestedActionsEnabled === true) {
    return true;
  }

  return DEFAULT_SUGGESTED_ACTIONS_ENABLED;
}

export function setWorkspaceSuggestedActionsEnabled(
  payload: Record<string, unknown>,
  enabled: boolean
): Record<string, unknown> {
  return {
    ...payload,
    suggestedActionsEnabled: enabled
  };
}
