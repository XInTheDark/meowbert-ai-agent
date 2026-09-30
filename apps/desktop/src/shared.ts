import type {
  ComputerToolName,
  DesktopComputerExecutorResult,
  DesktopComputerStatus
} from "@meowbert/shared";

export interface DesktopCapabilities {
  isDesktop: boolean;
  supportsServerProfiles: boolean;
  supportsNativeFileDialogs: boolean;
  supportsNativeDownloads: boolean;
  supportsRevealPath: boolean;
  supportsSecureAuthStorage: boolean;
  supportsGlobalShortcuts: boolean;
  supportsComputerUse: boolean;
}

export interface DesktopServerProfile {
  id: string;
  label: string;
  baseUrl: string;
  mode: "remote" | "local";
}

export interface DesktopServerProfilesState {
  profiles: DesktopServerProfile[];
  activeProfileId: string | null;
}

export interface DesktopShortcutPreferences {
  quickAgent: string | null;
  commandPalette: string | null;
  newTask: string | null;
  openFiles: string | null;
  uploadFiles: string | null;
  revealFolder: string | null;
}

export interface DesktopActiveContext {
  workspaceId: string | null;
  environmentId: string | null;
}

export interface DesktopBootstrapData {
  token: string | null;
  serverProfilesState: DesktopServerProfilesState;
  shortcutPreferences: DesktopShortcutPreferences;
  activeContext: DesktopActiveContext;
}

export interface DesktopNotificationInput {
  title: string;
  body?: string;
  tag?: string;
  route?: string;
}

export interface DesktopDownloadInput {
  url: string;
  token?: string | null;
  suggestedFilename?: string;
}

export interface DesktopDownloadResult {
  canceled: boolean;
  filePath: string | null;
}

export interface DesktopNavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
}

export type DesktopRevealPathInput =
  | {
      absolutePath: string;
    }
  | {
      rootPath: string;
      relativePath?: string | null;
    };

export interface DesktopPickedFile {
  name: string;
  type: string;
  dataBase64: string;
}

export interface DesktopComputerActionInput {
  toolName: ComputerToolName;
  args: Record<string, unknown>;
  taskId?: string | null;
  requestId?: string | null;
}

export type DesktopComputerActionResult = DesktopComputerExecutorResult;

export type {
  DesktopComputerStatus
};
