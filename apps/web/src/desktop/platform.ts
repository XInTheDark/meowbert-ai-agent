import type {
  ComputerToolName,
  DesktopComputerExecutorResult,
  DesktopComputerStatus
} from "@meowbert/shared";
import {
  DEFAULT_DESKTOP_SHORTCUT_PREFERENCES,
  sanitizeDesktopShortcutPreferences,
  type DesktopShortcutPreferences
} from "./desktopShortcuts";
import { apiBaseUrl as runtimeApiBaseUrl, defaultApiBaseUrl } from "../lib/runtime";

const AUTH_TOKEN_STORAGE_KEY = "meowbert_token";
const SERVER_PROFILES_STORAGE_KEY = "meowbert_server_profiles_v1";
export const DESKTOP_GITHUB_RETURN_ORIGIN = "desktop://meowbert";
export const DEFAULT_DESKTOP_PROFILE_ID = "desktop-default-local";
export const DEFAULT_DESKTOP_PROFILE_LABEL = "This computer";
export const DEFAULT_DESKTOP_SERVER_URL = "http://127.0.0.1:4000";

export type DesktopRuntimeMode = "remote" | "local";

export interface ServerProfile {
  id: string;
  label: string;
  baseUrl: string;
  mode: DesktopRuntimeMode;
}

export interface ServerProfilesState {
  profiles: ServerProfile[];
  activeProfileId: string | null;
}

export interface DesktopActiveContext {
  workspaceId: string | null;
  environmentId: string | null;
}

export interface PublicServerConfig {
  docsUrl?: string | null;
  publicUrl?: string | null;
  appUrl?: string | null;
}

export interface PlatformCapabilities {
  isDesktop: boolean;
  supportsServerProfiles: boolean;
  supportsNativeFileDialogs: boolean;
  supportsNativeDownloads: boolean;
  supportsRevealPath: boolean;
  supportsSecureAuthStorage: boolean;
  supportsGlobalShortcuts: boolean;
  supportsComputerUse: boolean;
}

export interface PlatformBootstrapData {
  token: string | null;
  serverProfilesState: ServerProfilesState;
  shortcutPreferences: DesktopShortcutPreferences;
  activeContext: DesktopActiveContext;
}

export type PlatformNotificationPermission = NotificationPermission | "unsupported";

export interface PlatformNotificationInput {
  title: string;
  body?: string;
  tag?: string;
  route?: string;
}

export interface DesktopPickedFile {
  name: string;
  type: string;
  dataBase64: string;
}

export interface PlatformDownloadInput {
  url: string;
  token?: string | null;
  suggestedFilename?: string;
}

export interface PlatformDownloadResult {
  canceled: boolean;
  filePath: string | null;
}

type RevealPathInput =
  | {
      absolutePath: string;
    }
  | {
      rootPath: string;
      relativePath?: string | null;
    };

interface DesktopBridge {
  capabilities: PlatformCapabilities;
  getBootstrapData: () => Promise<PlatformBootstrapData>;
  saveAuthToken: (token: string | null) => Promise<void>;
  saveServerProfilesState: (state: ServerProfilesState) => Promise<ServerProfilesState>;
  saveShortcutPreferences: (state: DesktopShortcutPreferences) => Promise<DesktopShortcutPreferences>;
  saveActiveContext: (state: DesktopActiveContext) => Promise<DesktopActiveContext>;
  getNotificationPermission: () => Promise<PlatformNotificationPermission>;
  requestNotificationPermission: () => Promise<PlatformNotificationPermission>;
  getComputerStatus: () => Promise<DesktopComputerStatus>;
  requestAccessibilityPermission: () => Promise<DesktopComputerStatus>;
  openScreenRecordingSettings: () => Promise<{ ok: boolean; error?: string }>;
  performComputerAction: (input: { toolName: ComputerToolName; args: Record<string, unknown>; taskId?: string | null; requestId?: string | null }) => Promise<DesktopComputerExecutorResult>;
  showNotification: (input: PlatformNotificationInput) => Promise<void>;
  pickFiles: () => Promise<DesktopPickedFile[]>;
  saveUrlToFile: (input: PlatformDownloadInput) => Promise<PlatformDownloadResult>;
  revealPath: (input: RevealPathInput) => Promise<{ ok: boolean; error?: string }>;
  openExternal: (url: string) => Promise<void>;
  showQuickAgent: () => Promise<void>;
  closeQuickAgent: () => Promise<void>;
  focusMainWindow: (route?: string) => Promise<void>;
  onNavigateRequested: (callback: (route: string) => void) => () => void;
  onQuickAgentActivated: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    meowbertDesktop?: DesktopBridge;
  }
}

export interface PlatformAdapter {
  capabilities: PlatformCapabilities;
  getBootstrapData: () => Promise<PlatformBootstrapData>;
  saveAuthToken: (token: string | null) => Promise<void>;
  saveServerProfilesState: (state: ServerProfilesState) => Promise<ServerProfilesState>;
  saveShortcutPreferences: (state: DesktopShortcutPreferences) => Promise<DesktopShortcutPreferences>;
  saveActiveContext: (state: DesktopActiveContext) => Promise<DesktopActiveContext>;
  getNotificationPermission: () => Promise<PlatformNotificationPermission>;
  requestNotificationPermission: () => Promise<PlatformNotificationPermission>;
  getComputerStatus: () => Promise<DesktopComputerStatus>;
  requestAccessibilityPermission: () => Promise<DesktopComputerStatus>;
  openScreenRecordingSettings: () => Promise<{ ok: boolean; error?: string }>;
  performComputerAction: (input: { toolName: ComputerToolName; args: Record<string, unknown>; taskId?: string | null; requestId?: string | null }) => Promise<DesktopComputerExecutorResult>;
  showNotification: (input: PlatformNotificationInput) => Promise<void>;
  pickFiles: () => Promise<File[]>;
  saveUrlToFile: (input: PlatformDownloadInput) => Promise<PlatformDownloadResult>;
  revealPath: (input: RevealPathInput) => Promise<{ ok: boolean; error?: string }>;
  openExternal: (url: string) => Promise<void>;
  showQuickAgent: () => Promise<void>;
  closeQuickAgent: () => Promise<void>;
  focusMainWindow: (route?: string) => Promise<void>;
  onNavigateRequested: (callback: (route: string) => void) => () => void;
  onQuickAgentActivated: (callback: () => void) => () => void;
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function isLoopbackUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.trim().toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function normalizeServerProfile(profile: ServerProfile): ServerProfile {
  const baseUrl = normalizeBaseUrl(profile.baseUrl);
  const isBuiltInDesktopProfile = profile.id === DEFAULT_DESKTOP_PROFILE_ID;

  return {
    ...profile,
    label: profile.label.trim() || (isBuiltInDesktopProfile ? DEFAULT_DESKTOP_PROFILE_LABEL : baseUrl),
    baseUrl,
    mode: (profile.mode === "local" || isLoopbackUrl(baseUrl) ? "local" : "remote") as DesktopRuntimeMode
  };
}

function isServerProfile(value: unknown): value is ServerProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && typeof candidate.label === "string"
    && typeof candidate.baseUrl === "string"
    && (candidate.mode === "remote" || candidate.mode === "local");
}

export function sanitizeServerProfilesState(input: unknown): ServerProfilesState {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      profiles: [],
      activeProfileId: null
    };
  }

  const candidate = input as {
    profiles?: unknown;
    activeProfileId?: unknown;
  };

  const profiles = Array.isArray(candidate.profiles)
    ? candidate.profiles.filter(isServerProfile).map((profile) => normalizeServerProfile(profile))
    : [];

  const activeProfileId = typeof candidate.activeProfileId === "string" ? candidate.activeProfileId : null;
  return {
    profiles,
    activeProfileId: activeProfileId && profiles.some((profile) => profile.id === activeProfileId)
      ? activeProfileId
      : profiles[0]?.id ?? null
  };
}

export function sanitizeDesktopActiveContext(input: unknown): DesktopActiveContext {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      workspaceId: null,
      environmentId: null
    };
  }

  const candidate = input as {
    workspaceId?: unknown;
    environmentId?: unknown;
  };

  return {
    workspaceId: typeof candidate.workspaceId === "string" && candidate.workspaceId.trim().length > 0
      ? candidate.workspaceId
      : null,
    environmentId: typeof candidate.environmentId === "string" && candidate.environmentId.trim().length > 0
      ? candidate.environmentId
      : null
  };
}

function defaultWebServerProfilesState(): ServerProfilesState {
  const baseUrl = defaultApiBaseUrl();
  return {
    profiles: [
      {
        id: "web-default",
        label: "Current server",
        baseUrl,
        mode: isLoopbackUrl(baseUrl) ? "local" : "remote"
      }
    ],
    activeProfileId: "web-default"
  };
}

export function resolveActiveServerProfile(state: ServerProfilesState): ServerProfile | null {
  if (state.activeProfileId) {
    const active = state.profiles.find((profile) => profile.id === state.activeProfileId);
    if (active) {
      return active;
    }
  }

  return state.profiles[0] ?? null;
}

function readLocalStorageJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readLocalStorageServerProfilesState(): ServerProfilesState {
  const parsed = sanitizeServerProfilesState(readLocalStorageJson(SERVER_PROFILES_STORAGE_KEY));
  if (parsed.profiles.length > 0) {
    return parsed;
  }
  return defaultWebServerProfilesState();
}

function writeLocalStorageServerProfilesState(state: ServerProfilesState): ServerProfilesState {
  const sanitized = sanitizeServerProfilesState(state);
  try {
    localStorage.setItem(SERVER_PROFILES_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore storage write failures and still return the sanitized value.
  }
  return sanitized;
}

function dataBase64ToFile(item: DesktopPickedFile): File {
  const binary = atob(item.dataBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], item.name, {
    type: item.type || "application/octet-stream"
  });
}

function createWebPlatform(): PlatformAdapter {
  const capabilities: PlatformCapabilities = {
    isDesktop: false,
    supportsServerProfiles: false,
    supportsNativeFileDialogs: false,
    supportsNativeDownloads: false,
    supportsRevealPath: false,
    supportsSecureAuthStorage: false,
    supportsGlobalShortcuts: false,
    supportsComputerUse: false
  };
  const unsupportedComputerStatus: DesktopComputerStatus = {
    available: false,
    platform: "web",
    permissions: {
      accessibility: "unsupported",
      screenRecording: "unsupported"
    },
    display: null,
    cursor: null,
    canTakeScreenshot: false,
    canControlComputer: false,
    requiresRestart: false,
    reason: "Computer use is only available in Meowbert Desktop."
  };

  return {
    capabilities,
    async getBootstrapData(): Promise<PlatformBootstrapData> {
      return {
        token: localStorage.getItem(AUTH_TOKEN_STORAGE_KEY),
        serverProfilesState: readLocalStorageServerProfilesState(),
        shortcutPreferences: sanitizeDesktopShortcutPreferences(DEFAULT_DESKTOP_SHORTCUT_PREFERENCES),
        activeContext: sanitizeDesktopActiveContext(null)
      };
    },
    async saveAuthToken(token: string | null): Promise<void> {
      if (token === null) {
        localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
        return;
      }

      localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    },
    async saveServerProfilesState(state: ServerProfilesState): Promise<ServerProfilesState> {
      return writeLocalStorageServerProfilesState(state);
    },
    async saveShortcutPreferences(state: DesktopShortcutPreferences): Promise<DesktopShortcutPreferences> {
      return sanitizeDesktopShortcutPreferences(state);
    },
    async saveActiveContext(state: DesktopActiveContext): Promise<DesktopActiveContext> {
      return sanitizeDesktopActiveContext(state);
    },
    async getNotificationPermission(): Promise<PlatformNotificationPermission> {
      if (typeof window === "undefined" || !("Notification" in window)) {
        return "unsupported";
      }
      return window.Notification.permission;
    },
    async requestNotificationPermission(): Promise<PlatformNotificationPermission> {
      if (typeof window === "undefined" || !("Notification" in window)) {
        return "unsupported";
      }
      return window.Notification.requestPermission();
    },
    async getComputerStatus(): Promise<DesktopComputerStatus> {
      return unsupportedComputerStatus;
    },
    async requestAccessibilityPermission(): Promise<DesktopComputerStatus> {
      return unsupportedComputerStatus;
    },
    async openScreenRecordingSettings(): Promise<{ ok: boolean; error?: string }> {
      return { ok: false, error: "Computer use is only available in Meowbert Desktop." };
    },
    async performComputerAction(): Promise<DesktopComputerExecutorResult> {
      return {
        type: "computer_action_result",
        requestId: "",
        taskId: "",
        toolName: "computer_screenshot",
        ok: false,
        error: "Computer use is only available in Meowbert Desktop.",
        completedAt: new Date().toISOString()
      };
    },
    async showNotification(input: PlatformNotificationInput): Promise<void> {
      if (typeof window === "undefined" || !("Notification" in window)) {
        return;
      }
      if (window.Notification.permission !== "granted") {
        return;
      }

      const notification = new window.Notification(input.title, {
        body: input.body,
        tag: input.tag
      });
      notification.onclick = () => {
        window.focus();
        if (input.route) {
          window.location.assign(input.route);
        }
        notification.close();
      };
    },
    async pickFiles(): Promise<File[]> {
      return [];
    },
    async saveUrlToFile(): Promise<PlatformDownloadResult> {
      return {
        canceled: true,
        filePath: null
      };
    },
    async revealPath(): Promise<{ ok: boolean }> {
      return { ok: false };
    },
    async openExternal(url: string): Promise<void> {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    async showQuickAgent(): Promise<void> {
      // Desktop-only.
    },
    async closeQuickAgent(): Promise<void> {
      // Desktop-only.
    },
    async focusMainWindow(route?: string): Promise<void> {
      window.focus();
      if (route) {
        window.location.assign(route);
      }
    },
    onNavigateRequested(): () => void {
      return () => undefined;
    },
    onQuickAgentActivated(): () => void {
      return () => undefined;
    }
  };
}

function createDesktopPlatform(bridge: DesktopBridge): PlatformAdapter {
  return {
    capabilities: bridge.capabilities,
    async getBootstrapData(): Promise<PlatformBootstrapData> {
      const data = await bridge.getBootstrapData();
      return {
        token: typeof data.token === "string" ? data.token : null,
        serverProfilesState: sanitizeServerProfilesState(data.serverProfilesState),
        shortcutPreferences: sanitizeDesktopShortcutPreferences(data.shortcutPreferences),
        activeContext: sanitizeDesktopActiveContext(data.activeContext)
      };
    },
    saveAuthToken: bridge.saveAuthToken,
    async saveServerProfilesState(state: ServerProfilesState): Promise<ServerProfilesState> {
      const saved = await bridge.saveServerProfilesState(sanitizeServerProfilesState(state));
      return sanitizeServerProfilesState(saved);
    },
    async saveShortcutPreferences(state: DesktopShortcutPreferences): Promise<DesktopShortcutPreferences> {
      const saved = await bridge.saveShortcutPreferences(sanitizeDesktopShortcutPreferences(state));
      return sanitizeDesktopShortcutPreferences(saved);
    },
    async saveActiveContext(state: DesktopActiveContext): Promise<DesktopActiveContext> {
      const saved = await bridge.saveActiveContext(sanitizeDesktopActiveContext(state));
      return sanitizeDesktopActiveContext(saved);
    },
    getNotificationPermission: bridge.getNotificationPermission,
    requestNotificationPermission: bridge.requestNotificationPermission,
    getComputerStatus: bridge.getComputerStatus,
    requestAccessibilityPermission: bridge.requestAccessibilityPermission,
    openScreenRecordingSettings: bridge.openScreenRecordingSettings,
    performComputerAction: bridge.performComputerAction,
    showNotification: bridge.showNotification,
    async pickFiles(): Promise<File[]> {
      const items = await bridge.pickFiles();
      return items.map(dataBase64ToFile);
    },
    saveUrlToFile: bridge.saveUrlToFile,
    revealPath: bridge.revealPath,
    openExternal: bridge.openExternal,
    showQuickAgent: bridge.showQuickAgent,
    closeQuickAgent: bridge.closeQuickAgent,
    focusMainWindow: bridge.focusMainWindow,
    onNavigateRequested: bridge.onNavigateRequested,
    onQuickAgentActivated: bridge.onQuickAgentActivated
  };
}

const desktopBridge = typeof window !== "undefined" ? window.meowbertDesktop : undefined;
export const platform: PlatformAdapter = desktopBridge ? createDesktopPlatform(desktopBridge) : createWebPlatform();

export async function fetchPublicServerConfig(baseUrl: string): Promise<PublicServerConfig | null> {
  const trimmedBaseUrl = normalizeBaseUrl(baseUrl);
  try {
    const response = await fetch(`${trimmedBaseUrl}/api/public/config`);
    if (!response.ok) {
      return null;
    }

    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") {
      return null;
    }

    return {
      docsUrl: typeof payload.docsUrl === "string" ? payload.docsUrl : null,
      publicUrl: typeof payload.publicUrl === "string" ? payload.publicUrl : null,
      appUrl: typeof payload.appUrl === "string" ? payload.appUrl : null
    };
  } catch {
    return null;
  }
}

export function desktopGithubReturnOrigin(): string {
  return DESKTOP_GITHUB_RETURN_ORIGIN;
}

export function currentServerBaseUrl(): string {
  return runtimeApiBaseUrl();
}
