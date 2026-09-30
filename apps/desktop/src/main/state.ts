import fs from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import type {
  DesktopActiveContext,
  DesktopBootstrapData,
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
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), "utf8");
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

export function getDefaultDesktopShortcutPreferences(): DesktopShortcutPreferences {
  return { ...DEFAULT_SHORTCUT_PREFERENCES };
}

export async function readBootstrapData(): Promise<DesktopBootstrapData> {
  const state = await readPersistedState();
  return {
    token: decodeToken(state.authToken),
    serverProfilesState: state.serverProfilesState ?? DEFAULT_SERVER_PROFILES_STATE,
    shortcutPreferences: sanitizeShortcutPreferences(state.shortcutPreferences),
    activeContext: sanitizeActiveContext(state.activeContext)
  };
}

export async function saveAuthToken(token: string | null): Promise<void> {
  const state = await readPersistedState();
  state.authToken = encodeToken(token);
  await writePersistedState(state);
}

export async function saveServerProfilesState(serverProfilesState: DesktopServerProfilesState): Promise<DesktopServerProfilesState> {
  const state = await readPersistedState();
  state.serverProfilesState = serverProfilesState;
  await writePersistedState(state);
  return serverProfilesState;
}

export async function saveShortcutPreferences(shortcutPreferences: DesktopShortcutPreferences): Promise<DesktopShortcutPreferences> {
  const sanitized = sanitizeShortcutPreferences(shortcutPreferences);
  const state = await readPersistedState();
  state.shortcutPreferences = sanitized;
  await writePersistedState(state);
  return sanitized;
}

export async function saveActiveContext(activeContext: DesktopActiveContext): Promise<DesktopActiveContext> {
  const sanitized = sanitizeActiveContext(activeContext);
  const state = await readPersistedState();
  state.activeContext = sanitized;
  await writePersistedState(state);
  return sanitized;
}

export function supportsSecureAuthStorage(): boolean {
  return safeStorage.isEncryptionAvailable();
}
