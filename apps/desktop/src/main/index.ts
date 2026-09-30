import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BrowserWindow,
  Menu,
  Notification,
  app,
  nativeImage,
  dialog,
  globalShortcut,
  ipcMain,
  shell,
  screen,
  type MenuItemConstructorOptions,
  type OpenDialogOptions
} from "electron";
import { isVisualComputerToolName, type TaskStatus } from "@meowbert/shared";
import type {
  DesktopActiveContext,
  DesktopComputerActionInput,
  DesktopComputerActionResult,
  DesktopCapabilities,
  DesktopDownloadInput,
  DesktopDownloadResult,
  DesktopNavigationState,
  DesktopNotificationInput,
  DesktopPickedFile,
  DesktopRevealPathInput,
  DesktopServerProfilesState,
  DesktopShortcutPreferences
} from "../shared";
import {
  getDefaultDesktopShortcutPreferences,
  readBootstrapData,
  saveActiveContext,
  saveAuthToken,
  saveServerProfilesState,
  saveShortcutPreferences,
  supportsSecureAuthStorage
} from "./state";
import { createDesktopUpdater, type DesktopUpdater } from "./updater";
import {
  getComputerUseStatus,
  openScreenRecordingSettings,
  performComputerAction,
  requestAccessibilityPermission
} from "./computer";
import { formatDesktopVersion } from "./version";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MAIN_WINDOW_ROUTE = "/";
const QUICK_AGENT_ROUTE = "/desktop/quick-agent";

let mainWindow: BrowserWindow | null = null;
let quickAgentWindow: BrowserWindow | null = null;
let computerUseWindow: BrowserWindow | null = null;
let ipcRegistered = false;
let currentShortcutPreferences: DesktopShortcutPreferences = getDefaultDesktopShortcutPreferences();
let desktopUpdater: DesktopUpdater | null = null;
let activeComputerUseTaskId: string | null = null;
let computerUseOverlayIdleTimer: ReturnType<typeof setTimeout> | null = null;
let computerUseStatusPollTimer: ReturnType<typeof setInterval> | null = null;
let computerUsePopupState: "active" | "succeeded" | "failed" | "cancelled" = "active";
const inFlightComputerActions = new Map<string, Promise<DesktopComputerActionResult>>();
const recentComputerActionResults = new Map<string, DesktopComputerActionResult>();
const recentComputerActionTimers = new Map<string, ReturnType<typeof setTimeout>>();

const COMPUTER_USE_POPUP_WIDTH = 352;
const COMPUTER_USE_POPUP_HEIGHT = 212;
const COMPUTER_USE_POPUP_MARGIN = 18;
const COMPUTER_USE_POPUP_IDLE_MS = 90_000;
const COMPUTER_USE_STATUS_POLL_MS = 5_000;
const COMPUTER_ACTION_RESULT_TTL_MS = 30_000;
const COMPUTER_ACTION_DEBUG_ENABLED = !app.isPackaged || process.env.MEOWBERT_DEBUG_COMPUTER_USE === "1";

function desktopCapabilities(): DesktopCapabilities {
  return {
    isDesktop: true,
    supportsServerProfiles: true,
    supportsNativeFileDialogs: true,
    supportsNativeDownloads: true,
    supportsRevealPath: true,
    supportsSecureAuthStorage: supportsSecureAuthStorage(),
    supportsGlobalShortcuts: true,
    supportsComputerUse: true
  };
}

function rendererDevUrl(): string | null {
  return process.env.ELECTRON_RENDERER_URL?.trim() || null;
}

function rendererHtmlPath(): string {
  return path.join(__dirname, "../renderer/index.html");
}

function desktopIconPath(): string {
  return path.resolve(__dirname, "../../build/icon.png");
}

function isInternalAppUrl(targetUrl: string): boolean {
  const devUrl = rendererDevUrl();
  if (devUrl && targetUrl.startsWith(devUrl)) {
    return true;
  }

  return targetUrl.startsWith("file://");
}

function loadRendererRoute(window: BrowserWindow, route: string): Promise<void> {
  const normalizedRoute = route.startsWith("/") ? route : `/${route}`;
  const devUrl = rendererDevUrl();
  if (devUrl) {
    return window.loadURL(`${devUrl}#${normalizedRoute}`);
  }

  return window.loadFile(rendererHtmlPath(), {
    hash: normalizedRoute
  });
}

function currentNavigationState(): DesktopNavigationState {
  const webContents = mainWindow?.webContents;
  return {
    canGoBack: webContents?.canGoBack() ?? false,
    canGoForward: webContents?.canGoForward() ?? false,
    isLoading: webContents?.isLoading() ?? false
  };
}

function broadcastNavigationState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("desktop:navigation-state-changed", currentNavigationState());
}

function navigateBack(): void {
  if (mainWindow?.webContents.canGoBack()) {
    mainWindow.webContents.goBack();
    return;
  }

  broadcastNavigationState();
}

function navigateForward(): void {
  if (mainWindow?.webContents.canGoForward()) {
    mainWindow.webContents.goForward();
    return;
  }

  broadcastNavigationState();
}

function reloadWindow(): void {
  mainWindow?.webContents.reload();
}

function installApplicationMenu(): void {
  const quickAgentAccelerator = currentShortcutPreferences.quickAgent?.trim() || undefined;
  const desktopDisplayVersion = formatDesktopVersion(app.getVersion());
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin"
      ? [{ role: "appMenu" as const }]
      : []),
    {
      label: "File",
      submenu: [
        ...(process.platform === "darwin"
          ? [{ role: "close" as const }]
          : [{ role: "quit" as const }])
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        {
          label: "Quick Agent",
          accelerator: quickAgentAccelerator,
          click: () => {
            void showQuickAgentWindow();
          }
        },
        {
          label: "Desktop Preferences",
          accelerator: "CommandOrControl+,",
          click: () => focusMainWindow("/desktop/preferences")
        },
        { type: "separator" },
        {
          label: "Back",
          accelerator: process.platform === "darwin" ? "Command+[" : "Alt+Left",
          click: () => navigateBack()
        },
        {
          label: "Forward",
          accelerator: process.platform === "darwin" ? "Command+]" : "Alt+Right",
          click: () => navigateForward()
        },
        {
          label: "Reload",
          accelerator: "CommandOrControl+R",
          click: () => reloadWindow()
        },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(rendererDevUrl()
          ? [{ role: "toggleDevTools" as const }]
          : [])
      ]
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Check for Updates...",
          click: () => {
            void desktopUpdater?.checkForUpdates();
          }
        },
        {
          label: "Download Latest Release",
          click: () => {
            void desktopUpdater?.openReleasesPage();
          }
        },
        { type: "separator" },
        {
          label: `Version ${desktopDisplayVersion}`,
          enabled: false
        }
      ]
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(process.platform === "darwin"
          ? [{ type: "separator" as const }, { role: "front" as const }]
          : [{ role: "close" as const }])
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function focusMainWindow(route?: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow(route ?? MAIN_WINDOW_ROUTE);
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  if (route) {
    mainWindow.webContents.send("desktop:navigate", route);
  }
}

function closeQuickAgentWindow(): void {
  if (!quickAgentWindow || quickAgentWindow.isDestroyed()) {
    return;
  }

  quickAgentWindow.hide();
}

async function showQuickAgentWindow(): Promise<void> {
  const window = (!quickAgentWindow || quickAgentWindow.isDestroyed())
    ? createQuickAgentWindow()
    : quickAgentWindow;

  const present = () => {
    if (window.isDestroyed()) {
      return;
    }

    window.center();
    window.show();
    window.focus();
    window.webContents.send("desktop:quick-agent-activated");
  };

  if (window.webContents.isLoadingMainFrame()) {
    window.once("ready-to-show", present);
    return;
  }

  present();
}

function clearComputerUseOverlayTimer(): void {
  if (computerUseOverlayIdleTimer) {
    clearTimeout(computerUseOverlayIdleTimer);
    computerUseOverlayIdleTimer = null;
  }
}

function logComputerActionDebug(
  event: string,
  input: {
    requestId?: string | null;
    taskId?: string | null;
    toolName?: string | null;
    details?: Record<string, unknown>;
  }
): void {
  if (!COMPUTER_ACTION_DEBUG_ENABLED) {
    return;
  }

  console.info("[desktop-computer]", {
    event,
    requestId: input.requestId ?? null,
    taskId: input.taskId ?? null,
    toolName: input.toolName ?? null,
    ...(input.details ? { details: input.details } : {})
  });
}

function rememberComputerActionResult(requestId: string, result: DesktopComputerActionResult): void {
  recentComputerActionResults.set(requestId, result);
  const existingTimer = recentComputerActionTimers.get(requestId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    recentComputerActionResults.delete(requestId);
    recentComputerActionTimers.delete(requestId);
  }, COMPUTER_ACTION_RESULT_TTL_MS);
  recentComputerActionTimers.set(requestId, timer);
}

function clearComputerUseStatusPollTimer(): void {
  if (computerUseStatusPollTimer) {
    clearInterval(computerUseStatusPollTimer);
    computerUseStatusPollTimer = null;
  }
}

function isTerminalTaskStatus(status: string): status is Extract<TaskStatus, "succeeded" | "failed" | "cancelled"> {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function computerUsePopupHtml(taskId: string, state: "active" | "succeeded" | "failed" | "cancelled"): string {
  const safeTaskId = JSON.stringify(taskId);
  const isActive = state === "active";
  const title =
    state === "succeeded"
      ? "Task complete"
      : state === "failed"
        ? "Task ended with an error"
        : state === "cancelled"
          ? "Task cancelled"
          : "Meowbert is using your computer";
  const description =
    state === "succeeded"
      ? "The task finished. Open Meowbert to review the result."
      : state === "failed"
        ? "The task stopped with an error. Open Meowbert to review what happened."
        : state === "cancelled"
          ? "The task was cancelled. Open Meowbert if you want to review it."
          : "It will hide itself during desktop actions so screenshots and clicks stay clean.";
  const actionsHtml = isActive
    ? `
      <div class="actions active">
        <button id="open">Open Meowbert</button>
        <button id="cancel" class="danger">Cancel task</button>
      </div>
    `
    : `
      <div class="actions done">
        <button id="open" class="primary">Open Meowbert</button>
      </div>
    `;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Computer Use</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: #0c1220;
        color: #f6f8fc;
        display: flex;
      }
      main {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        background:
          radial-gradient(circle at top left, rgba(122, 162, 255, 0.22), transparent 42%),
          linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02)),
          #0f172a;
      }
      h1 {
        margin: 0;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.01em;
      }
      p {
        margin: 0;
        color: rgba(230, 236, 245, 0.82);
        font-size: 12px;
        line-height: 1.5;
      }
      .meta {
        font-size: 11px;
        color: rgba(174, 186, 204, 0.92);
      }
      .actions {
        margin-top: auto;
        display: grid;
        gap: 10px;
      }
      .actions.active {
        grid-template-columns: 1fr 1fr;
      }
      .actions.done {
        grid-template-columns: 1fr;
      }
      button {
        appearance: none;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 12px;
        padding: 10px 12px;
        background: rgba(255,255,255,0.04);
        color: inherit;
        font: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }
      button:hover {
        background: rgba(255,255,255,0.08);
      }
      button.primary {
        background: rgba(122, 162, 255, 0.16);
        border-color: rgba(122, 162, 255, 0.3);
      }
      button.danger {
        border-color: rgba(248, 113, 113, 0.3);
        color: #fecaca;
      }
      #status {
        min-height: 18px;
      }
    </style>
  </head>
  <body>
    <main>
      <div>
        <h1>${title}</h1>
        <p>${description}</p>
      </div>
      <p class="meta">Task: <code>${taskId}</code></p>
      <p id="status" class="meta"></p>
      ${actionsHtml}
    </main>
    <script>
      const taskId = ${safeTaskId};
      const isActive = ${JSON.stringify(isActive)};
      const status = document.getElementById("status");
      const openButton = document.getElementById("open");
      const cancelButton = document.getElementById("cancel");

      openButton.addEventListener("click", () => {
        window.meowbertDesktop?.focusMainWindow();
      });

      cancelButton?.addEventListener("click", async () => {
        if (!window.meowbertDesktop?.cancelTask) {
          status.textContent = "Cancel action is unavailable.";
          return;
        }

        cancelButton.disabled = true;
        status.textContent = "Cancelling task...";
        try {
          const result = await window.meowbertDesktop.cancelTask(taskId);
          if (result?.ok) {
            status.textContent = "Cancellation requested.";
          } else {
            status.textContent = result?.error || "Unable to cancel the task.";
            cancelButton.disabled = false;
          }
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : String(error);
          cancelButton.disabled = false;
        }
      });

      if (!isActive) {
        status.textContent = "";
      }
    </script>
  </body>
</html>`;
}

function positionComputerUseWindow(window: BrowserWindow): void {
  const display = screen.getPrimaryDisplay();
  const workArea = display.workArea;
  const x = workArea.x + workArea.width - COMPUTER_USE_POPUP_WIDTH - COMPUTER_USE_POPUP_MARGIN;
  const y = workArea.y + COMPUTER_USE_POPUP_MARGIN;
  window.setBounds({
    x,
    y,
    width: COMPUTER_USE_POPUP_WIDTH,
    height: COMPUTER_USE_POPUP_HEIGHT
  });
}

function createComputerUseWindow(): BrowserWindow {
  computerUseWindow = new BrowserWindow({
    width: COMPUTER_USE_POPUP_WIDTH,
    height: COMPUTER_USE_POPUP_HEIGHT,
    minWidth: COMPUTER_USE_POPUP_WIDTH,
    minHeight: COMPUTER_USE_POPUP_HEIGHT,
    maxWidth: COMPUTER_USE_POPUP_WIDTH,
    maxHeight: COMPUTER_USE_POPUP_HEIGHT,
    title: "Computer Use",
    show: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#0c1220",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.platform === "darwin") {
    computerUseWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    });
  }

  registerExternalNavigation(computerUseWindow);
  computerUseWindow.on("closed", () => {
    computerUseWindow = null;
  });

  return computerUseWindow;
}

function hideComputerUseWindow(): void {
  if (!computerUseWindow || computerUseWindow.isDestroyed()) {
    return;
  }

  computerUseWindow.hide();
}

function clearComputerUseSession(): void {
  activeComputerUseTaskId = null;
  computerUsePopupState = "active";
  clearComputerUseOverlayTimer();
  clearComputerUseStatusPollTimer();
  if (!computerUseWindow || computerUseWindow.isDestroyed()) {
    computerUseWindow = null;
    return;
  }

  computerUseWindow.close();
}

function hideDesktopWindowsForComputerUse(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
  if (quickAgentWindow && !quickAgentWindow.isDestroyed()) {
    quickAgentWindow.hide();
  }
}

async function showComputerUseWindow(taskId: string, state: "active" | "succeeded" | "failed" | "cancelled" = "active"): Promise<void> {
  const window = (!computerUseWindow || computerUseWindow.isDestroyed())
    ? createComputerUseWindow()
    : computerUseWindow;

  computerUsePopupState = state;
  const encodedHtml = `data:text/html;charset=utf-8,${encodeURIComponent(computerUsePopupHtml(taskId, state))}`;
  if (window.webContents.getURL() !== encodedHtml) {
    await window.loadURL(encodedHtml);
  }

  positionComputerUseWindow(window);
  window.showInactive();
  if (state === "active") {
    clearComputerUseOverlayTimer();
    computerUseOverlayIdleTimer = setTimeout(() => {
      clearComputerUseSession();
    }, COMPUTER_USE_POPUP_IDLE_MS);
  } else {
    clearComputerUseOverlayTimer();
  }
}

function resolveDesktopApiBaseUrl(serverProfilesState: DesktopServerProfilesState): string | null {
  if (serverProfilesState.activeProfileId) {
    const activeProfile = serverProfilesState.profiles.find((profile) => profile.id === serverProfilesState.activeProfileId);
    if (activeProfile?.baseUrl) {
      return activeProfile.baseUrl.replace(/\/+$/, "");
    }
  }

  const fallbackProfile = serverProfilesState.profiles[0];
  return fallbackProfile?.baseUrl ? fallbackProfile.baseUrl.replace(/\/+$/, "") : null;
}

async function cancelTask(taskId: string): Promise<{ ok: boolean; error?: string }> {
  const normalizedTaskId = taskId.trim();
  if (!normalizedTaskId) {
    return { ok: false, error: "Task id is required." };
  }

  const bootstrap = await readBootstrapData();
  const token = bootstrap.token?.trim();
  const apiBaseUrl = resolveDesktopApiBaseUrl(bootstrap.serverProfilesState);
  if (!token || !apiBaseUrl) {
    return { ok: false, error: "Sign in to Meowbert Desktop before cancelling tasks here." };
  }

  const response = await fetch(`${apiBaseUrl}/api/tasks/${normalizedTaskId}/cancel`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({})
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const payload = await response.json() as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim().length > 0) {
        errorMessage = payload.error;
      }
    } catch {
      // Ignore payload parse failures and fall back to the HTTP status.
    }
    return { ok: false, error: errorMessage };
  }

  clearComputerUseSession();
  focusMainWindow();
  return { ok: true };
}

async function fetchTaskStatus(taskId: string): Promise<TaskStatus | null> {
  const bootstrap = await readBootstrapData();
  const token = bootstrap.token?.trim();
  const apiBaseUrl = resolveDesktopApiBaseUrl(bootstrap.serverProfilesState);
  if (!token || !apiBaseUrl) {
    return null;
  }

  const response = await fetch(`${apiBaseUrl}/api/tasks/${taskId}?messageDetail=none`, {
    headers: {
      authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as { task?: { status?: unknown } };
  return typeof payload.task?.status === "string" ? payload.task.status as TaskStatus : null;
}

async function refreshComputerUsePopupState(taskId: string): Promise<void> {
  if (activeComputerUseTaskId !== taskId) {
    return;
  }

  try {
    const status = await fetchTaskStatus(taskId);
    if (!status || !isTerminalTaskStatus(status)) {
      return;
    }

    clearComputerUseStatusPollTimer();
    if (computerUsePopupState !== status) {
      await showComputerUseWindow(taskId, status);
    }
  } catch (error) {
    console.error("Failed to refresh computer use task status", error);
  }
}

function startComputerUseStatusPolling(taskId: string): void {
  clearComputerUseStatusPollTimer();
  void refreshComputerUsePopupState(taskId);
  computerUseStatusPollTimer = setInterval(() => {
    void refreshComputerUsePopupState(taskId);
  }, COMPUTER_USE_STATUS_POLL_MS);
}

function resolveRevealPath(input: DesktopRevealPathInput): string {
  if ("absolutePath" in input) {
    return path.resolve(input.absolutePath);
  }

  const rootPath = path.resolve(input.rootPath);
  const targetPath = path.resolve(rootPath, input.relativePath ?? ".");
  const relative = path.relative(rootPath, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path is outside the environment root.");
  }

  return targetPath;
}

async function pickFiles(): Promise<DesktopPickedFile[]> {
  const dialogOptions: OpenDialogOptions = {
    properties: ["openFile", "multiSelections"]
  };
  const ownerWindow = BrowserWindow.getFocusedWindow() ?? mainWindow ?? quickAgentWindow ?? undefined;
  const result = ownerWindow
    ? await dialog.showOpenDialog(ownerWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);
  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }

  const files = await Promise.all(result.filePaths.map(async (filePath) => {
    const data = await fs.readFile(filePath);
    return {
      name: path.basename(filePath),
      type: "",
      dataBase64: data.toString("base64")
    } satisfies DesktopPickedFile;
  }));

  return files;
}

async function saveUrlToFile(input: DesktopDownloadInput): Promise<DesktopDownloadResult> {
  const suggestedFilename = input.suggestedFilename?.trim() || (() => {
    try {
      return path.basename(new URL(input.url).pathname) || "download";
    } catch {
      return "download";
    }
  })();

  const dialogOptions = {
    defaultPath: suggestedFilename
  };
  const ownerWindow = BrowserWindow.getFocusedWindow() ?? mainWindow ?? quickAgentWindow ?? undefined;
  const result = ownerWindow
    ? await dialog.showSaveDialog(ownerWindow, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions);
  if (result.canceled || !result.filePath) {
    return {
      canceled: true,
      filePath: null
    };
  }

  const response = await fetch(input.url, {
    headers: input.token ? { authorization: `Bearer ${input.token}` } : undefined
  });
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(result.filePath, buffer);
  return {
    canceled: false,
    filePath: result.filePath
  };
}

async function revealPath(input: DesktopRevealPathInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const targetPath = resolveRevealPath(input);
    const stats = await fs.stat(targetPath);
    if (stats.isDirectory()) {
      const openError = await shell.openPath(targetPath);
      if (openError) {
        return { ok: false, error: openError };
      }
      return { ok: true };
    }

    shell.showItemInFolder(targetPath);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function showDesktopNotification(input: DesktopNotificationInput): void {
  if (!Notification.isSupported()) {
    return;
  }

  const notification = new Notification({
    title: input.title,
    body: input.body,
    silent: false
  });
  notification.on("click", () => {
    focusMainWindow(input.route);
  });
  notification.show();
}

function registerIpcHandlers(): void {
  if (ipcRegistered) {
    return;
  }
  ipcRegistered = true;

  ipcMain.on("desktop:get-capabilities", (event) => {
    event.returnValue = desktopCapabilities();
  });

  ipcMain.handle("desktop:get-bootstrap-data", () => readBootstrapData());
  ipcMain.handle("desktop:save-auth-token", (_event, token: string | null) => saveAuthToken(token));
  ipcMain.handle("desktop:get-computer-status", () => getComputerUseStatus());
  ipcMain.handle("desktop:request-accessibility-permission", () => requestAccessibilityPermission());
  ipcMain.handle("desktop:open-screen-recording-settings", () => openScreenRecordingSettings());
  ipcMain.handle("desktop:perform-computer-action", async (_event, input: DesktopComputerActionInput) => {
    const normalizedRequestId = input.requestId?.trim() || null;
    if (normalizedRequestId) {
      const cachedResult = recentComputerActionResults.get(normalizedRequestId);
      if (cachedResult) {
        logComputerActionDebug("return_cached_result", {
          requestId: normalizedRequestId,
          taskId: input.taskId,
          toolName: input.toolName
        });
        return cachedResult;
      }

      const inFlightAction = inFlightComputerActions.get(normalizedRequestId);
      if (inFlightAction) {
        logComputerActionDebug("join_in_flight_action", {
          requestId: normalizedRequestId,
          taskId: input.taskId,
          toolName: input.toolName
        });
        return inFlightAction;
      }
    }

    const actionPromise = (async (): Promise<DesktopComputerActionResult> => {
      try {
        const normalizedTaskId = input.taskId?.trim() || null;
        const managesOverlay = normalizedTaskId !== null && isVisualComputerToolName(input.toolName);
        const isFirstRequestForTask = managesOverlay && activeComputerUseTaskId !== normalizedTaskId;

        logComputerActionDebug("execute_action", {
          requestId: normalizedRequestId,
          taskId: normalizedTaskId,
          toolName: input.toolName,
          details: {
            managesOverlay,
            isFirstRequestForTask
          }
        });

        try {
          if (managesOverlay) {
            if (isFirstRequestForTask) {
              activeComputerUseTaskId = normalizedTaskId;
              computerUsePopupState = "active";
              hideDesktopWindowsForComputerUse();
              startComputerUseStatusPolling(normalizedTaskId);
            }
            hideComputerUseWindow();
          }
        } catch (error) {
          console.error("Failed to prepare computer use overlay", error);
        }

        const result = await performComputerAction(input);

        if (managesOverlay && normalizedTaskId) {
          try {
            await showComputerUseWindow(normalizedTaskId, "active");
          } catch (error) {
            console.error("Failed to show computer use overlay", error);
          }
        }

        logComputerActionDebug("action_completed", {
          requestId: normalizedRequestId,
          taskId: normalizedTaskId,
          toolName: input.toolName,
          details: {
            ok: result.ok
          }
        });
        return result;
      } catch (error) {
        logComputerActionDebug("action_failed", {
          requestId: normalizedRequestId,
          taskId: input.taskId,
          toolName: input.toolName,
          details: {
            error: error instanceof Error ? error.message : String(error)
          }
        });
        throw error;
      }
    })();

    if (normalizedRequestId) {
      inFlightComputerActions.set(normalizedRequestId, actionPromise);
    }

    try {
      const result = await actionPromise;
      if (normalizedRequestId) {
        rememberComputerActionResult(normalizedRequestId, result);
      }
      return result;
    } finally {
      if (normalizedRequestId && inFlightComputerActions.get(normalizedRequestId) === actionPromise) {
        inFlightComputerActions.delete(normalizedRequestId);
      }
    }
  });
  ipcMain.handle(
    "desktop:save-server-profiles-state",
    (_event, state: DesktopServerProfilesState) => saveServerProfilesState(state)
  );
  ipcMain.handle(
    "desktop:save-shortcut-preferences",
    async (_event, state: DesktopShortcutPreferences) => {
      const previousPreferences = currentShortcutPreferences;
      const saved = await saveShortcutPreferences(state);

      try {
        registerGlobalShortcuts(saved);
        currentShortcutPreferences = saved;
        installApplicationMenu();
        return saved;
      } catch (error) {
        currentShortcutPreferences = previousPreferences;
        await saveShortcutPreferences(previousPreferences);
        try {
          registerGlobalShortcuts(previousPreferences);
        } catch {
          // Keep best-effort rollback; the error below is the relevant one for the renderer.
        }
        installApplicationMenu();
        throw error;
      }
    }
  );
  ipcMain.handle(
    "desktop:save-active-context",
    (_event, state: DesktopActiveContext) => saveActiveContext(state)
  );
  ipcMain.handle("desktop:get-notification-permission", () => (
    Notification.isSupported() ? "granted" : "unsupported"
  ));
  ipcMain.handle("desktop:request-notification-permission", () => (
    Notification.isSupported() ? "granted" : "unsupported"
  ));
  ipcMain.handle("desktop:show-notification", (_event, input: DesktopNotificationInput) => {
    showDesktopNotification(input);
  });
  ipcMain.handle("desktop:pick-files", () => pickFiles());
  ipcMain.handle("desktop:save-url-to-file", (_event, input: DesktopDownloadInput) => saveUrlToFile(input));
  ipcMain.handle("desktop:reveal-path", (_event, input: DesktopRevealPathInput) => revealPath(input));
  ipcMain.handle("desktop:open-external", (_event, targetUrl: string) => safeOpenExternal(targetUrl));
  ipcMain.handle("desktop:cancel-task", (_event, taskId: string) => cancelTask(taskId));
  ipcMain.handle("desktop:get-navigation-state", () => currentNavigationState());
  ipcMain.handle("desktop:window-go-back", () => navigateBack());
  ipcMain.handle("desktop:window-go-forward", () => navigateForward());
  ipcMain.handle("desktop:window-reload", () => reloadWindow());
  ipcMain.handle("desktop:show-quick-agent", async () => {
    await showQuickAgentWindow();
  });
  ipcMain.handle("desktop:close-quick-agent", () => {
    closeQuickAgentWindow();
  });
  ipcMain.handle("desktop:focus-main-window", (_event, route?: string) => {
    focusMainWindow(route);
  });
}

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export async function safeOpenExternal(targetUrl: string): Promise<void> {
  if (typeof targetUrl !== "string" || !targetUrl.trim()) {
    return;
  }
  try {
    const parsed = new URL(targetUrl);
    if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
      console.warn(`[desktop] Blocked opening external URL with disallowed protocol: ${parsed.protocol}`);
      return;
    }
    await shell.openExternal(parsed.toString());
  } catch {
    // Malformed URL; ignore.
  }
}

function registerWindowNavigationEvents(window: BrowserWindow): void {
  const syncNavigationState = () => {
    broadcastNavigationState();
  };

  window.webContents.on("did-start-loading", syncNavigationState);
  window.webContents.on("did-stop-loading", syncNavigationState);
  window.webContents.on("did-finish-load", syncNavigationState);
  window.webContents.on("did-navigate", syncNavigationState);
  window.webContents.on("did-navigate-in-page", syncNavigationState);
}

function registerExternalNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    void safeOpenExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, targetUrl) => {
    if (isInternalAppUrl(targetUrl)) {
      return;
    }

    event.preventDefault();
    void safeOpenExternal(targetUrl);
  });
}

function createMainWindow(initialRoute = MAIN_WINDOW_ROUTE): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    title: "Meowbert",
    backgroundColor: "#0c1220",
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  registerWindowNavigationEvents(mainWindow);
  registerExternalNavigation(mainWindow);

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    broadcastNavigationState();
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  void loadRendererRoute(mainWindow, initialRoute);
  return mainWindow;
}

function createQuickAgentWindow(): BrowserWindow {
  quickAgentWindow = new BrowserWindow({
    width: 780,
    height: 340,
    minWidth: 680,
    minHeight: 300,
    maxWidth: 920,
    maxHeight: 460,
    show: false,
    frame: false,
    resizable: true,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    title: "Quick Agent",
    backgroundColor: "#0c1220",
    autoHideMenuBar: true,
    roundedCorners: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.platform === "darwin") {
    quickAgentWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true
    });
  }

  registerExternalNavigation(quickAgentWindow);

  quickAgentWindow.on("closed", () => {
    quickAgentWindow = null;
  });

  void loadRendererRoute(quickAgentWindow, QUICK_AGENT_ROUTE);
  return quickAgentWindow;
}

function registerGlobalShortcuts(preferences: DesktopShortcutPreferences): void {
  globalShortcut.unregisterAll();

  const quickAgentAccelerator = preferences.quickAgent?.trim();
  if (!quickAgentAccelerator) {
    return;
  }

  const registered = globalShortcut.register(quickAgentAccelerator, () => {
    void showQuickAgentWindow();
  });
  if (!registered) {
    throw new Error(`Unable to register Quick Agent shortcut (${quickAgentAccelerator}). It may already be in use.`);
  }
}

app.whenReady().then(async () => {
  app.setName("Meowbert");
  app.setAboutPanelOptions({
    applicationName: "Meowbert",
    applicationVersion: formatDesktopVersion(app.getVersion()),
    version: app.getVersion()
  });
  if (!app.isPackaged && process.platform === "darwin") {
    const dock = app.dock;
    const dockIcon = nativeImage.createFromPath(desktopIconPath());
    if (dock && !dockIcon.isEmpty()) {
      dock.setIcon(dockIcon);
    }
  }

  desktopUpdater = createDesktopUpdater({
    getOwnerWindow: () => BrowserWindow.getFocusedWindow() ?? mainWindow ?? quickAgentWindow,
    focusMainWindow: () => focusMainWindow()
  });

  registerIpcHandlers();

  const bootstrap = await readBootstrapData();
  currentShortcutPreferences = bootstrap.shortcutPreferences;
  try {
    registerGlobalShortcuts(currentShortcutPreferences);
  } catch (error) {
    console.error("Failed to register desktop shortcuts", error);
  }

  installApplicationMenu();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      return;
    }

    focusMainWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
