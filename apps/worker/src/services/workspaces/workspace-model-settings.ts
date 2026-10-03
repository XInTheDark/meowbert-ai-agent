const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_SHELL_TOOL_MAX_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_MCP_TIMEOUT_MS = 60 * 1000;

export type WorkspaceImageDetail = "high" | "original";
export type WorkspaceCompactionBackend = "summary" | "native";

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

export function resolveWorkspaceModelRequestTimeoutMs(modelDefaults: Record<string, unknown> | null | undefined): number {
  const defaults = modelDefaults ?? {};
  const timeoutMsCandidate =
    parsePositiveInteger(defaults.modelRequestTimeoutMs) ?? parsePositiveInteger(defaults.hardTimeoutMs);
  if (typeof timeoutMsCandidate === "number") {
    return timeoutMsCandidate;
  }

  const timeoutSecondsCandidate =
    parsePositiveInteger(defaults.modelRequestTimeoutSeconds) ?? parsePositiveInteger(defaults.hardTimeoutSeconds);
  if (typeof timeoutSecondsCandidate === "number") {
    return timeoutSecondsCandidate * 1000;
  }

  return DEFAULT_MODEL_REQUEST_TIMEOUT_MS;
}

export function resolveWorkspaceShellToolMaxTimeoutMs(modelDefaults: Record<string, unknown> | null | undefined): number {
  const defaults = modelDefaults ?? {};
  const timeoutMsCandidate = parsePositiveInteger(defaults.shellToolMaxTimeoutMs);
  if (typeof timeoutMsCandidate === "number") {
    return timeoutMsCandidate;
  }

  const timeoutSecondsCandidate = parsePositiveInteger(defaults.shellToolMaxTimeoutSeconds);
  if (typeof timeoutSecondsCandidate === "number") {
    return timeoutSecondsCandidate * 1000;
  }

  return DEFAULT_SHELL_TOOL_MAX_TIMEOUT_MS;
}

export function resolveWorkspaceMcpTimeoutMs(modelDefaults: Record<string, unknown> | null | undefined): number {
  const defaults = modelDefaults ?? {};
  const timeoutMsCandidate = parsePositiveInteger(defaults.mcpTimeoutMs);
  if (typeof timeoutMsCandidate === "number") {
    return timeoutMsCandidate;
  }

  const timeoutSecondsCandidate = parsePositiveInteger(defaults.mcpTimeoutSeconds);
  if (typeof timeoutSecondsCandidate === "number") {
    return timeoutSecondsCandidate * 1000;
  }

  return DEFAULT_MCP_TIMEOUT_MS;
}


export function resolveWorkspaceCompactionBackend(
  modelDefaults: Record<string, unknown> | null | undefined
): WorkspaceCompactionBackend {
  const defaults = modelDefaults ?? {};
  if (defaults.nativeCompaction === false) {
    return "summary";
  }

  const configuredBackend = defaults.contextCompactionBackend;
  if (typeof configuredBackend === "string") {
    const trimmed = configuredBackend.trim().toLowerCase();
    if (trimmed === "summary") {
      return "summary";
    }
    if (trimmed === "native") {
      return "native";
    }
  }

  if (defaults.nativeCompaction === true) {
    return "native";
  }

  return "native";
}

export function resolveWorkspaceContextManagementToolsEnabled(
  modelDefaults: Record<string, unknown> | null | undefined
): boolean {
  return modelDefaults?.contextManagementToolsEnabled !== false;
}

export function resolveWorkspaceClaudeCacheKeepalive(
  modelDefaults: Record<string, unknown> | null | undefined
): boolean {
  return modelDefaults?.claudeCacheKeepalive !== false;
}

export function resolveWorkspaceCodeModeEnabled(
  modelDefaults: Record<string, unknown> | null | undefined
): boolean {
  return modelDefaults?.codeModeEnabled === true;
}

export function resolveWorkspaceSendMetadataToModel(
  modelDefaults: Record<string, unknown> | null | undefined
): boolean {
  return modelDefaults?.sendMetadataToModel === true;
}
