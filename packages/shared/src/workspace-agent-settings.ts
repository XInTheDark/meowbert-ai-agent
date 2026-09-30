function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneJsonValue(entry)) as T;
  }

  if (isPlainObject(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      clone[key] = cloneJsonValue(entry);
    }
    return clone as T;
  }

  return value;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export interface WorkspaceDefaultToolset {
  webSearch: boolean;
  memorySearch: boolean;
  scheduleTask: boolean;
  subtasks: boolean;
  computerUse: boolean;
  interactiveCanvas?: boolean;
  enabledSkills: string[];
  enabledSources: string[];
}

export const WORKSPACE_DEFAULT_TOOLSET_CANVAS_SKILL_ID = "html-canvas";

export const DEFAULT_WORKSPACE_DEFAULT_TOOLSET: WorkspaceDefaultToolset = {
  webSearch: true,
  memorySearch: false,
  scheduleTask: true,
  subtasks: false,
  computerUse: false,
  interactiveCanvas: false,
  enabledSkills: [WORKSPACE_DEFAULT_TOOLSET_CANVAS_SKILL_ID],
  enabledSources: []
};

function normalizePersonalityId(value: unknown): string | null {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeToolIdList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  return Array.from(new Set(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  ));
}

function asDefaultContext(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return payload && isPlainObject(payload.default_context) ? payload.default_context : {};
}

function asSandbox(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return payload && isPlainObject(payload.sandbox) ? payload.sandbox : {};
}

function asPersistentRuntime(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return payload && isPlainObject(payload.persistent_runtime) ? payload.persistent_runtime : {};
}

function asDefaultToolset(payload: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (payload && isPlainObject(payload.default_toolset)) {
    return payload.default_toolset;
  }

  return payload && isPlainObject(payload.defaultToolset) ? payload.defaultToolset : {};
}

function cleanupDefaultContext(
  payload: Record<string, unknown>,
  defaultContext: Record<string, unknown>
): Record<string, unknown> {
  if (Object.keys(defaultContext).length === 0) {
    delete payload.default_context;
    return payload;
  }

  payload.default_context = defaultContext;
  return payload;
}

function cleanupSandbox(
  payload: Record<string, unknown>,
  sandbox: Record<string, unknown>
): Record<string, unknown> {
  if (Object.keys(sandbox).length === 0) {
    delete payload.sandbox;
    return payload;
  }

  payload.sandbox = sandbox;
  return payload;
}

export function getWorkspaceSystemPrompt(
  payload: Record<string, unknown> | null | undefined
): string {
  const systemPrompt = asDefaultContext(payload).system_prompt;
  return typeof systemPrompt === "string" ? systemPrompt : "";
}

export function getPersistentRuntimeEnabled(
  payload: Record<string, unknown> | null | undefined
): boolean {
  return asPersistentRuntime(payload).enabled !== false;
}

export function setPersistentRuntimeEnabled(
  payload: Record<string, unknown>,
  enabled: boolean
): Record<string, unknown> {
  const normalized = { ...payload };
  const persistentRuntime = { ...asPersistentRuntime(normalized) };
  persistentRuntime.enabled = enabled;
  normalized.persistent_runtime = persistentRuntime;

  return normalized;
}

export function setWorkspaceSystemPrompt(
  payload: Record<string, unknown>,
  systemPrompt: string | null
): Record<string, unknown> {
  const normalized = { ...payload };
  const defaultContext = { ...asDefaultContext(normalized) };
  const nextPrompt = normalizeOptionalString(systemPrompt);

  if (nextPrompt) {
    defaultContext.system_prompt = systemPrompt;
  } else {
    delete defaultContext.system_prompt;
  }

  return cleanupDefaultContext(normalized, defaultContext);
}

export function getWorkspacePersonalityId(
  payload: Record<string, unknown> | null | undefined
): string | null {
  return normalizePersonalityId(asDefaultContext(payload).personality);
}

export function setWorkspacePersonalityId(
  payload: Record<string, unknown>,
  personalityId: string | null
): Record<string, unknown> {
  const normalized = { ...payload };
  const defaultContext = { ...asDefaultContext(normalized) };
  const nextPersonalityId = normalizePersonalityId(personalityId);

  if (nextPersonalityId) {
    defaultContext.personality = nextPersonalityId;
  } else {
    delete defaultContext.personality;
  }

  return cleanupDefaultContext(normalized, defaultContext);
}

export function normalizeWorkspaceDefaultToolset(value: unknown): WorkspaceDefaultToolset {
  const candidate = isPlainObject(value) ? value : {};

  return {
    webSearch: typeof candidate.webSearch === "boolean"
      ? candidate.webSearch
      : DEFAULT_WORKSPACE_DEFAULT_TOOLSET.webSearch,
    memorySearch: false,
    scheduleTask: typeof candidate.scheduleTask === "boolean"
      ? candidate.scheduleTask
      : DEFAULT_WORKSPACE_DEFAULT_TOOLSET.scheduleTask,
    subtasks: typeof candidate.subtasks === "boolean"
      ? candidate.subtasks
      : DEFAULT_WORKSPACE_DEFAULT_TOOLSET.subtasks,
    computerUse: typeof candidate.computerUse === "boolean"
      ? candidate.computerUse
      : DEFAULT_WORKSPACE_DEFAULT_TOOLSET.computerUse,
    interactiveCanvas: typeof candidate.interactiveCanvas === "boolean"
      ? candidate.interactiveCanvas
      : DEFAULT_WORKSPACE_DEFAULT_TOOLSET.interactiveCanvas,
    enabledSkills: normalizeToolIdList(candidate.enabledSkills, DEFAULT_WORKSPACE_DEFAULT_TOOLSET.enabledSkills),
    enabledSources: normalizeToolIdList(candidate.enabledSources, DEFAULT_WORKSPACE_DEFAULT_TOOLSET.enabledSources)
  };
}

export function getWorkspaceDefaultToolset(
  payload: Record<string, unknown> | null | undefined
): WorkspaceDefaultToolset {
  return normalizeWorkspaceDefaultToolset(asDefaultToolset(payload));
}

export function setWorkspaceDefaultToolset(
  payload: Record<string, unknown>,
  toolset: unknown
): Record<string, unknown> {
  const normalized = { ...payload };
  normalized.default_toolset = normalizeWorkspaceDefaultToolset(toolset);
  delete normalized.defaultToolset;
  return normalized;
}

export function getSandboxNetworkEnabledOverride(
  payload: Record<string, unknown> | null | undefined
): boolean | null {
  const sandbox = asSandbox(payload);

  if (typeof sandbox.network_enabled === "boolean") {
    return sandbox.network_enabled;
  }

  if (typeof sandbox.networkEnabled === "boolean") {
    return sandbox.networkEnabled;
  }

  return null;
}

export function setSandboxNetworkEnabledOverride(
  payload: Record<string, unknown>,
  enabled: boolean | null
): Record<string, unknown> {
  const normalized = { ...payload };
  const sandbox = { ...asSandbox(normalized) };

  delete sandbox.network_enabled;
  delete sandbox.networkEnabled;

  if (typeof enabled === "boolean") {
    sandbox.network_enabled = enabled;
  }

  return cleanupSandbox(normalized, sandbox);
}

export function extractWorkspaceEnvironmentDefaults(
  workspaceModelDefaults: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  const systemPrompt = getWorkspaceSystemPrompt(workspaceModelDefaults);
  const personalityId = getWorkspacePersonalityId(workspaceModelDefaults);
  const sandboxNetworkEnabled = getSandboxNetworkEnabledOverride(workspaceModelDefaults);

  let withDefaultContext = defaults;
  if (systemPrompt.trim().length > 0) {
    withDefaultContext = setWorkspaceSystemPrompt(withDefaultContext, systemPrompt);
  }
  if (personalityId) {
    withDefaultContext = setWorkspacePersonalityId(withDefaultContext, personalityId);
  }

  if (typeof sandboxNetworkEnabled === "boolean") {
    return setSandboxNetworkEnabledOverride(withDefaultContext, sandboxNetworkEnabled);
  }

  return withDefaultContext;
}

export function resolveEffectiveEnvironmentJsonPayload(input: {
  workspaceModelDefaults?: Record<string, unknown> | null;
  environmentPayload?: unknown;
}): Record<string, unknown> {
  const environmentPayload = isPlainObject(input.environmentPayload)
    ? cloneJsonValue(input.environmentPayload)
    : {};
  const workspaceSystemPrompt = normalizeOptionalString(getWorkspaceSystemPrompt(input.workspaceModelDefaults));
  const environmentSystemPrompt = normalizeOptionalString(getWorkspaceSystemPrompt(environmentPayload));
  const workspacePersonalityId = getWorkspacePersonalityId(input.workspaceModelDefaults);
  const environmentPersonalityId = getWorkspacePersonalityId(environmentPayload);
  const workspaceNetworkOverride = getSandboxNetworkEnabledOverride(input.workspaceModelDefaults);
  const environmentNetworkOverride = getSandboxNetworkEnabledOverride(environmentPayload);

  const effective = environmentPayload;
  const defaultContext = { ...asDefaultContext(effective) };
  delete defaultContext.system_prompt;
  delete defaultContext.personality;

  const effectiveSystemPrompt = workspaceSystemPrompt && environmentSystemPrompt
    ? `${workspaceSystemPrompt}\n\n${environmentSystemPrompt}`
    : workspaceSystemPrompt ?? environmentSystemPrompt ?? null;
  if (effectiveSystemPrompt) {
    defaultContext.system_prompt = effectiveSystemPrompt;
  }

  const effectivePersonalityId = environmentPersonalityId ?? workspacePersonalityId;
  if (effectivePersonalityId) {
    defaultContext.personality = effectivePersonalityId;
  }

  cleanupDefaultContext(effective, defaultContext);

  const sandbox = { ...asSandbox(effective) };
  delete sandbox.network_enabled;
  delete sandbox.networkEnabled;

  const effectiveNetworkOverride = environmentNetworkOverride ?? workspaceNetworkOverride;
  if (typeof effectiveNetworkOverride === "boolean") {
    sandbox.network_enabled = effectiveNetworkOverride;
  }

  cleanupSandbox(effective, sandbox);

  return effective;
}
export function getWorkspaceDefaultAgentId(settings: Record<string, unknown> | null | undefined): string | null {
  return typeof settings?.defaultAgentId === "string" && settings.defaultAgentId.trim().length > 0
    ? settings.defaultAgentId
    : null;
}

export const DEFAULT_PROJECT_MASTER_ENABLED = true;

export function getProjectMasterEnabled(settings: Record<string, unknown> | null | undefined): boolean {
  return typeof settings?.projectMasterEnabled === "boolean"
    ? settings.projectMasterEnabled
    : DEFAULT_PROJECT_MASTER_ENABLED;
}

export const DEFAULT_NEW_MESSAGE_ORGANIZATION_ENABLED = true;

export function getNewMessageOrganizationEnabled(settings: Record<string, unknown> | null | undefined): boolean {
  return typeof settings?.newMessageOrganizationEnabled === "boolean"
    ? settings.newMessageOrganizationEnabled
    : DEFAULT_NEW_MESSAGE_ORGANIZATION_ENABLED;
}
