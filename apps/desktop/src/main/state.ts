import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { app, safeStorage } from "electron";
import type {
  DesktopActiveContext,
  DesktopBootstrapData,
  DesktopLocalExecutionSettings,
  DesktopServerProfilesState,
  DesktopShortcutPreferences
} from "../shared";

interface PersistedTokenEnvelope {
  mode: "none" | "plain" | "safe-storage";
  value: string | null;
}

interface PersistedDesktopState {
  authToken?: PersistedTokenEnvelope;
  serverProfilesState?: DesktopServerProfilesState;
  shortcutPreferences?: DesktopShortcutPreferences;
  activeContext?: DesktopActiveContext;
  localExecutionSettingsByServer?: Record<string, DesktopLocalExecutionSettings>;
}

const DEFAULT_SERVER_PROFILES_STATE: DesktopServerProfilesState = {
  profiles: [],
  activeProfileId: null
};

const DEFAULT_SHORTCUT_PREFERENCES: DesktopShortcutPreferences = {
  quickAgent: "CommandOrControl+Shift+Space",
  commandPalette: "CommandOrControl+K",
  newTask: "CommandOrControl+N",
  openFiles: "CommandOrControl+Shift+F",
  uploadFiles: "CommandOrControl+Shift+U",
  revealFolder: "CommandOrControl+Shift+O"
};

const DEFAULT_ACTIVE_CONTEXT: DesktopActiveContext = {
  workspaceId: null,
  environmentId: null
};

function stateFilePath(): string {
  return path.join(app.getPath("userData"), "desktop-state.json");
}

async function readPersistedState(): Promise<PersistedDesktopState> {
  try {
    const raw = await fs.readFile(stateFilePath(), "utf8");
    const parsed = JSON.parse(raw) as PersistedDesktopState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writePersistedState(state: PersistedDesktopState): Promise<void> {
  const filePath = stateFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath + ".tmp", JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  await fs.rename(filePath + ".tmp", filePath);
}

function encodeToken(token: string | null): PersistedTokenEnvelope {
  if (!token) {
    return {
      mode: "none",
      value: null
    };
  }

  if (safeStorage.isEncryptionAvailable()) {
    return {
      mode: "safe-storage",
      value: safeStorage.encryptString(token).toString("base64")
    };
  }

  return {
    mode: "plain",
    value: token
  };
}

function decodeToken(envelope: PersistedTokenEnvelope | undefined): string | null {
  if (!envelope || envelope.mode === "none" || !envelope.value) {
    return null;
  }

  if (envelope.mode === "safe-storage") {
    try {
      return safeStorage.decryptString(Buffer.from(envelope.value, "base64"));
    } catch {
      return null;
    }
  }

  return envelope.value;
}

function normalizeShortcutValue(value: unknown, fallback: string | null): string | null {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeShortcutPreferences(input: unknown): DesktopShortcutPreferences {
  const candidate = input && typeof input === "object" && !Array.isArray(input)
    ? input as Partial<Record<keyof DesktopShortcutPreferences, unknown>>
    : {};

  return {
    quickAgent: normalizeShortcutValue(candidate.quickAgent, DEFAULT_SHORTCUT_PREFERENCES.quickAgent),
    commandPalette: normalizeShortcutValue(candidate.commandPalette, DEFAULT_SHORTCUT_PREFERENCES.commandPalette),
    newTask: normalizeShortcutValue(candidate.newTask, DEFAULT_SHORTCUT_PREFERENCES.newTask),
    openFiles: normalizeShortcutValue(candidate.openFiles, DEFAULT_SHORTCUT_PREFERENCES.openFiles),
    uploadFiles: normalizeShortcutValue(candidate.uploadFiles, DEFAULT_SHORTCUT_PREFERENCES.uploadFiles),
    revealFolder: normalizeShortcutValue(candidate.revealFolder, DEFAULT_SHORTCUT_PREFERENCES.revealFolder)
  };
}

function sanitizeActiveContext(input: unknown): DesktopActiveContext {
  const candidate = input && typeof input === "object" && !Array.isArray(input)
    ? input as Partial<Record<keyof DesktopActiveContext, unknown>>
    : {};

  return {
    workspaceId: typeof candidate.workspaceId === "string" && candidate.workspaceId.trim().length > 0
      ? candidate.workspaceId
      : null,
    environmentId: typeof candidate.environmentId === "string" && candidate.environmentId.trim().length > 0
      ? candidate.environmentId
      : null
  };
}

function sanitizeLocalExecutionSettings(input: unknown): DesktopLocalExecutionSettings {
  const candidate = input && typeof input === "object" && !Array.isArray(input)
    ? input as Partial<DesktopLocalExecutionSettings>
    : {};
  return {
    maxConcurrentRuns: typeof candidate.maxConcurrentRuns === "number" && Number.isFinite(candidate.maxConcurrentRuns) ? Math.max(1, Math.min(16, Math.floor(candidate.maxConcurrentRuns))) : 2,
    serverBaseUrl: typeof candidate.serverBaseUrl === "string" ? candidate.serverBaseUrl : null,
    downloadConsent: candidate.downloadConsent === true,
    enabled: candidate.enabled === true,
    deviceId: typeof candidate.deviceId === "string" && /^[0-9a-f-]{36}$/i.test(candidate.deviceId)
      ? candidate.deviceId
      : randomUUID(),
    storageBackendId: typeof candidate.storageBackendId === "string" && candidate.storageBackendId.trim()
      ? candidate.storageBackendId.trim()
      : "local-default",
    storageRoot: typeof candidate.storageRoot === "string" && candidate.storageRoot.trim()
      ? path.resolve(candidate.storageRoot.trim())
      : null
  };
}

export function getDefaultDesktopShortcutPreferences(): DesktopShortcutPreferences {
  return { ...DEFAULT_SHORTCUT_PREFERENCES };
}

let pendingStateWrite: Promise<unknown> = Promise.resolve();
function updateState<T>(update: (state: PersistedDesktopState) => T): Promise<T> {
  const work = pendingStateWrite.then(async () => {
    const state = await readPersistedState();
    const result = update(state);
    await writePersistedState(state);
    return result;
  });
  pendingStateWrite = work.catch(() => undefined);
  return work;
}
function activeServerKey(state: PersistedDesktopState): string {
  const profiles = state.serverProfilesState;
  const profile = profiles?.profiles.find((entry) => entry.id === profiles.activeProfileId) ?? profiles?.profiles[0];
  return profile?.baseUrl.replace(/\/+$/, "") ?? "";
}
export async function readBootstrapData(): Promise<DesktopBootstrapData> {
  return updateState((state) => {
    const key = activeServerKey(state);
    const settings = sanitizeLocalExecutionSettings(state.localExecutionSettingsByServer?.[key]);
    settings.serverBaseUrl = key || null;
    state.localExecutionSettingsByServer ??= {};
    state.localExecutionSettingsByServer[key] = settings;
    return {
      token: decodeToken(state.authToken),
      serverProfilesState: state.serverProfilesState ?? DEFAULT_SERVER_PROFILES_STATE,
      shortcutPreferences: sanitizeShortcutPreferences(state.shortcutPreferences),
      activeContext: sanitizeActiveContext(state.activeContext), localExecutionSettings: settings
    };
  });
}
export async function saveLocalExecutionSettings(input: DesktopLocalExecutionSettings): Promise<DesktopLocalExecutionSettings> {
  return updateState((state) => {
    const key = activeServerKey(state);
    if (!key || input.serverBaseUrl !== key) throw new Error("The selected server changed. Reload Local Execution settings.");
    const previous = state.localExecutionSettingsByServer?.[key];
    const settings = sanitizeLocalExecutionSettings({ ...input, deviceId: previous?.deviceId ?? input.deviceId });
    state.localExecutionSettingsByServer ??= {};
    state.localExecutionSettingsByServer[key] = settings;
    return settings;
  });
}
export async function saveAuthToken(token: string | null): Promise<void> {
  await updateState((state) => { state.authToken = encodeToken(token); });
}
export async function saveServerProfilesState(input: DesktopServerProfilesState): Promise<DesktopServerProfilesState> {
  return updateState((state) => { state.serverProfilesState = input; return input; });
}
export async function saveShortcutPreferences(input: DesktopShortcutPreferences): Promise<DesktopShortcutPreferences> {
  return updateState((state) => { const value = sanitizeShortcutPreferences(input); state.shortcutPreferences = value; return value; });
}
export async function saveActiveContext(input: DesktopActiveContext): Promise<DesktopActiveContext> {
  return updateState((state) => { const value = sanitizeActiveContext(input); state.activeContext = value; return value; });
}

export function supportsSecureAuthStorage(): boolean {
  return safeStorage.isEncryptionAvailable();
}

export async function listLocalExecutionDeviceIds(): Promise<string[]> {
  await pendingStateWrite;
  const state = await readPersistedState();
  return [...new Set(Object.values(state.localExecutionSettingsByServer ?? {}).map((settings) => settings.deviceId))];
}
