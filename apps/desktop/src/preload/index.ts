import { contextBridge, ipcRenderer } from "electron";
import type {
  DesktopActiveContext,
  DesktopComputerActionInput,
  DesktopComputerActionResult,
  DesktopBootstrapData,
  DesktopCapabilities,
  DesktopDownloadInput,
  DesktopDownloadResult,
  DesktopNavigationState,
  DesktopNotificationInput,
  DesktopPickedFile,
  DesktopRevealPathInput,
  DesktopComputerStatus,
  DesktopServerProfilesState,
  DesktopShortcutPreferences
} from "../shared";

const capabilities = ipcRenderer.sendSync("desktop:get-capabilities") as DesktopCapabilities;

contextBridge.exposeInMainWorld("meowbertDesktop", {
  capabilities,
  getBootstrapData: (): Promise<DesktopBootstrapData> => ipcRenderer.invoke("desktop:get-bootstrap-data"),
  saveAuthToken: (token: string | null): Promise<void> => ipcRenderer.invoke("desktop:save-auth-token", token),
  saveServerProfilesState: (state: DesktopServerProfilesState): Promise<DesktopServerProfilesState> =>
    ipcRenderer.invoke("desktop:save-server-profiles-state", state),
  saveShortcutPreferences: (state: DesktopShortcutPreferences): Promise<DesktopShortcutPreferences> =>
    ipcRenderer.invoke("desktop:save-shortcut-preferences", state),
  saveActiveContext: (state: DesktopActiveContext): Promise<DesktopActiveContext> =>
    ipcRenderer.invoke("desktop:save-active-context", state),
  getNotificationPermission: (): Promise<NotificationPermission | "unsupported"> =>
    ipcRenderer.invoke("desktop:get-notification-permission"),
  requestNotificationPermission: (): Promise<NotificationPermission | "unsupported"> =>
    ipcRenderer.invoke("desktop:request-notification-permission"),
  getComputerStatus: (): Promise<DesktopComputerStatus> => ipcRenderer.invoke("desktop:get-computer-status"),
  requestAccessibilityPermission: (): Promise<DesktopComputerStatus> =>
    ipcRenderer.invoke("desktop:request-accessibility-permission"),
  openScreenRecordingSettings: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("desktop:open-screen-recording-settings"),
  performComputerAction: (input: DesktopComputerActionInput): Promise<DesktopComputerActionResult> =>
    ipcRenderer.invoke("desktop:perform-computer-action", input),
  showNotification: (input: DesktopNotificationInput): Promise<void> =>
    ipcRenderer.invoke("desktop:show-notification", input),
  pickFiles: (): Promise<DesktopPickedFile[]> => ipcRenderer.invoke("desktop:pick-files"),
  saveUrlToFile: (input: DesktopDownloadInput): Promise<DesktopDownloadResult> =>
    ipcRenderer.invoke("desktop:save-url-to-file", input),
  revealPath: (input: DesktopRevealPathInput): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke("desktop:reveal-path", input),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("desktop:open-external", url),
  cancelTask: (taskId: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke("desktop:cancel-task", taskId),
  getNavigationState: (): Promise<DesktopNavigationState> => ipcRenderer.invoke("desktop:get-navigation-state"),
  windowGoBack: (): Promise<void> => ipcRenderer.invoke("desktop:window-go-back"),
  windowGoForward: (): Promise<void> => ipcRenderer.invoke("desktop:window-go-forward"),
  windowReload: (): Promise<void> => ipcRenderer.invoke("desktop:window-reload"),
  showQuickAgent: (): Promise<void> => ipcRenderer.invoke("desktop:show-quick-agent"),
  closeQuickAgent: (): Promise<void> => ipcRenderer.invoke("desktop:close-quick-agent"),
  focusMainWindow: (route?: string): Promise<void> => ipcRenderer.invoke("desktop:focus-main-window", route),
  onNavigateRequested: (callback: (route: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, route: string) => callback(route);
    ipcRenderer.on("desktop:navigate", listener);
    return () => {
      ipcRenderer.removeListener("desktop:navigate", listener);
    };
  },
  onNavigationStateChanged: (callback: (state: DesktopNavigationState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: DesktopNavigationState) => callback(state);
    ipcRenderer.on("desktop:navigation-state-changed", listener);
    return () => {
      ipcRenderer.removeListener("desktop:navigation-state-changed", listener);
    };
  },
  onQuickAgentActivated: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("desktop:quick-agent-activated", listener);
    return () => {
      ipcRenderer.removeListener("desktop:quick-agent-activated", listener);
    };
  }
});
