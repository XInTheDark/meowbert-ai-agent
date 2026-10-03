export interface PlatformModelMetadataEntry extends Record<string, unknown> {
  code_mode?: boolean;
  compatibility?: PlatformModelCompatibilityMode[];
  context_management?: PlatformContextManagementVersion;
  context_window?: number;
  type?: PlatformModelType;
}

export type PlatformModelMetadata = Record<string, PlatformModelMetadataEntry>;
export type PlatformModelCompatibilityMode = "noSystemMessages" | "noDeveloperMessages" | "forceFixDoubleResponse" | "forcePersistReasoningContent" | "parseXMLToolCalls" | "disablePdfFile";
export type PlatformModelType = "openai" | "google" | "claude";
export type PlatformContextManagementVersion = "v1" | "v2";

export const DEFAULT_MAX_CONTEXT_WINDOW_TOKENS = 256_000;
export const DEFAULT_MODEL_TYPE: PlatformModelType = "openai";

export const DEFAULT_PLATFORM_MODEL_METADATA: PlatformModelMetadata = {
  default: {
    context_window: DEFAULT_MAX_CONTEXT_WINDOW_TOKENS,
    type: DEFAULT_MODEL_TYPE
  }
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepCloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => deepCloneJsonValue(entry));
  }

  if (isPlainObject(value)) {
    const clone: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      clone[key] = deepCloneJsonValue(entry);
    }
    return clone;
  }

  return value;
}

function cloneEntry(entry: PlatformModelMetadataEntry): PlatformModelMetadataEntry {
  return deepCloneJsonValue(entry) as PlatformModelMetadataEntry;
}

export function clonePlatformModelMetadata(metadata: PlatformModelMetadata): PlatformModelMetadata {
  const clone: PlatformModelMetadata = {};
  for (const [key, entry] of Object.entries(metadata)) {
    clone[key] = cloneEntry(entry);
  }
  return clone;
}

function normalizeModelKey(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeContextWindow(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return Math.max(1, Math.floor(numeric));
}

function normalizeModelType(value: unknown): PlatformModelType | null {
  if (value === "openai" || value === "google" || value === "claude") {
    return value;
  }
  if (value === "gemini") {
    return "google";
  }
  if (value === "anthropic") {
    return "claude";
  }

  return null;
}

function normalizeContextManagementVersion(value: unknown): PlatformContextManagementVersion | null {
  return value === "v1" || value === "v2" ? value : null;
}

function normalizeCompatibilityModes(value: unknown): PlatformModelCompatibilityMode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const modes: PlatformModelCompatibilityMode[] = [];
  for (const mode of value) {
    if (
      (mode === "noSystemMessages" || mode === "noDeveloperMessages" || mode === "forceFixDoubleResponse" || mode === "forcePersistReasoningContent" || mode === "parseXMLToolCalls" || mode === "disablePdfFile")
      && !modes.includes(mode)
    ) {
      modes.push(mode);
    }
  }

  return modes;
}

function normalizeEntry(rawEntry: unknown, fallbackToDefaultContextWindow: boolean): PlatformModelMetadataEntry | null {
  if (!isPlainObject(rawEntry)) {
    return fallbackToDefaultContextWindow
      ? { context_window: DEFAULT_MAX_CONTEXT_WINDOW_TOKENS, type: DEFAULT_MODEL_TYPE }
      : null;
  }

  const entry = cloneEntry(rawEntry);
  const hasCompatibilityModes = Object.prototype.hasOwnProperty.call(entry, "compatibility");
  const compatibilityModes = normalizeCompatibilityModes(entry.compatibility);
  const contextWindow = normalizeContextWindow(entry.context_window);
  const modelType = normalizeModelType(entry.type);
  const contextManagementVersion = normalizeContextManagementVersion(entry.context_management);

  if (hasCompatibilityModes) {
    entry.compatibility = compatibilityModes;
  }

  if (contextWindow === null) {
    delete entry.context_window;
  } else {
    entry.context_window = contextWindow;
  }

  if (fallbackToDefaultContextWindow && typeof entry.context_window !== "number") {
    entry.context_window = DEFAULT_MAX_CONTEXT_WINDOW_TOKENS;
  }

  if (modelType === null) {
    delete entry.type;
  } else {
    entry.type = modelType;
  }

  if (contextManagementVersion === null) {
    delete entry.context_management;
  } else {
    entry.context_management = contextManagementVersion;
  }

  if (typeof entry.code_mode !== "boolean") {
    delete entry.code_mode;
  }

  if (fallbackToDefaultContextWindow && !entry.type) {
    entry.type = DEFAULT_MODEL_TYPE;
  }

  return entry;
}

export function normalizePlatformModelMetadata(rawValue: unknown): PlatformModelMetadata {
  if (!isPlainObject(rawValue)) {
    return clonePlatformModelMetadata(DEFAULT_PLATFORM_MODEL_METADATA);
  }

  const rawRecord = rawValue as Record<string, unknown>;
  const normalized: PlatformModelMetadata = {
    default: normalizeEntry(rawRecord.default, true) ?? {
      context_window: DEFAULT_MAX_CONTEXT_WINDOW_TOKENS,
      type: DEFAULT_MODEL_TYPE
    }
  };

  for (const [rawKey, rawEntry] of Object.entries(rawRecord)) {
    const modelKey = normalizeModelKey(rawKey);
    if (!modelKey || modelKey === "default") {
      continue;
    }

    const normalizedEntry = normalizeEntry(rawEntry, false);
    if (!normalizedEntry) {
      continue;
    }

    normalized[modelKey] = normalizedEntry;
  }

  return normalized;
}

export function resolveModelTypeForModel(model: string | null | undefined, rawMetadata: unknown): PlatformModelType {
  const metadata = normalizePlatformModelMetadata(rawMetadata);
  const normalizedModel = normalizeModelKey(model);

  if (normalizedModel) {
    const exactModelType = normalizeModelType(metadata[normalizedModel]?.type);
    if (exactModelType) {
      return exactModelType;
    }
  }

  return normalizeModelType(metadata.default?.type) ?? DEFAULT_MODEL_TYPE;
}

export function resolveCompatibilityModesForModel(
  model: string | null | undefined,
  rawMetadata: unknown
): PlatformModelCompatibilityMode[] {
  const metadata = normalizePlatformModelMetadata(rawMetadata);
  const normalizedModel = normalizeModelKey(model);

  if (normalizedModel) {
    const exactEntry = metadata[normalizedModel];
    if (exactEntry && Object.prototype.hasOwnProperty.call(exactEntry, "compatibility")) {
      return normalizeCompatibilityModes(exactEntry.compatibility);
    }
  }

  return normalizeCompatibilityModes(metadata.default?.compatibility);
}

export function resolveContextWindowForModel(model: string | null | undefined, rawMetadata: unknown): number {
  const metadata = normalizePlatformModelMetadata(rawMetadata);
  const normalizedModel = normalizeModelKey(model);

  if (normalizedModel) {
    const entry = metadata[normalizedModel];
    const exactContextWindow = normalizeContextWindow(entry?.context_window);
    if (exactContextWindow !== null) {
      return exactContextWindow;
    }
  }

  return normalizeContextWindow(metadata.default?.context_window) ?? DEFAULT_MAX_CONTEXT_WINDOW_TOKENS;
}

export function resolveContextManagementVersionForModel(
  model: string | null | undefined,
  rawMetadata: unknown
): PlatformContextManagementVersion {
  const metadata = normalizePlatformModelMetadata(rawMetadata);
  const normalizedModel = normalizeModelKey(model);

  if (normalizedModel) {
    const exact = normalizeContextManagementVersion(metadata[normalizedModel]?.context_management);
    if (exact) {
      return exact;
    }
  }

  return normalizeContextManagementVersion(metadata.default?.context_management) ?? "v2";
}

// Code mode is on unless the model's entry (or the default entry) turns it off.
export function resolveCodeModeForModel(model: string | null | undefined, rawMetadata: unknown): boolean {
  const metadata = normalizePlatformModelMetadata(rawMetadata);
  const normalizedModel = normalizeModelKey(model);
  const exact = normalizedModel ? metadata[normalizedModel]?.code_mode : undefined;
  if (typeof exact === "boolean") {
    return exact;
  }

  return metadata.default?.code_mode !== false;
}
