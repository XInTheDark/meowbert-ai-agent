import { app, dialog, shell, type MessageBoxOptions, type MessageBoxReturnValue, type BrowserWindow } from "electron";
import electronUpdater, { type AppUpdater, type ProgressInfo, type UpdateInfo } from "electron-updater";
import { formatDesktopVersion } from "./version";
import type { DesktopUpdater, DesktopUpdaterOptions, UpdateCheckOrigin } from "./updater";

const BACKGROUND_UPDATE_CHECK_DELAY_MS = 15_000;
const BACKGROUND_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type ShowUpdateMessage = (options: MessageBoxOptions) => Promise<MessageBoxReturnValue>;
interface WindowsUpdateState {
  currentOrigin: UpdateCheckOrigin | null;
  lastDownloadedVersionPrompted: string | null;
  manualDownloadPending: boolean;
}

function currentDisplayVersion(): string {
  return formatDesktopVersion(app.getVersion());
}

function updateDisplayVersion(info: UpdateInfo): string {
  return formatDesktopVersion(info.version);
}

function registerWindowsUpdateEvents(
  updater: AppUpdater, state: WindowsUpdateState, options: DesktopUpdaterOptions,
  showMessageBox: ShowUpdateMessage, clearProgressBar: () => void, setProgressBar: (percent: number) => void
): void {
  updater.on("update-available", (info: UpdateInfo) => {
    if (state.currentOrigin !== "manual") {
      return;
    }

    state.manualDownloadPending = true;
    void showMessageBox({
      type: "info",
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
      title: "Update available",
      message: `Meowbert ${updateDisplayVersion(info)} is downloading now.`,
      detail: "You will be prompted to restart once the download finishes."
    });
  });

  updater.on("update-not-available", () => {
    clearProgressBar();
    state.manualDownloadPending = false;
    if (state.currentOrigin !== "manual") {
      return;
    }

    void showMessageBox({
      type: "info",
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
      title: "Up to date",
      message: "You already have the latest Meowbert desktop build.",
      detail: `Current version: ${currentDisplayVersion()}`
    });
  });

  updater.on("download-progress", (progress: ProgressInfo) => {
    setProgressBar(progress.percent);
  });

  updater.on("update-downloaded", (info: UpdateInfo) => {
    clearProgressBar();
    state.manualDownloadPending = false;
    if (state.lastDownloadedVersionPrompted === info.version) {
      return;
    }
    state.lastDownloadedVersionPrompted = info.version;

    options.focusMainWindow();
    void showMessageBox({
      type: "info",
      buttons: ["Install and Relaunch", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `Meowbert ${updateDisplayVersion(info)} is ready to install.`,
      detail: "Choose Install and Relaunch to restart now, or Later to finish the update the next time you quit the app."
    }).then((result) => {
      if (result.response === 0) {
        updater.quitAndInstall();
      }
    });
  });

  updater.on("error", (error: unknown) => {
    clearProgressBar();
    console.error("Desktop updater error", error);
    const shouldNotifyUser = state.currentOrigin === "manual" || state.manualDownloadPending;
    state.manualDownloadPending = false;
    if (!shouldNotifyUser) {
      return;
    }

    const detail = error instanceof Error ? error.message : String(error);
    void showMessageBox({
      type: "error",
      buttons: ["OK"],
      defaultId: 0,
      cancelId: 0,
      title: "Update check failed",
      message: "Meowbert could not check for updates.",
      detail
    });
  });
}

export function createWindowsDesktopUpdater(options: DesktopUpdaterOptions, releasesUrl: string): DesktopUpdater {
  const updater = electronUpdater.autoUpdater as AppUpdater;
  let activeCheck: Promise<void> | null = null;
  let backgroundTimeout: NodeJS.Timeout | null = null;
  let backgroundInterval: NodeJS.Timeout | null = null;
  const state: WindowsUpdateState = { currentOrigin: null, lastDownloadedVersionPrompted: null, manualDownloadPending: false };

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = app.getVersion().includes("-");

  function ownerWindow(): BrowserWindow | null {
    return options.getOwnerWindow();
  }

  async function showMessageBox(messageBoxOptions: MessageBoxOptions) {
    const window = ownerWindow();
    return window
      ? dialog.showMessageBox(window, { noLink: true, ...messageBoxOptions })
      : dialog.showMessageBox({ noLink: true, ...messageBoxOptions });
  }

  function setProgressBar(progressPercent: number): void {
    ownerWindow()?.setProgressBar(progressPercent / 100);
  }

  function clearProgressBar(): void {
    ownerWindow()?.setProgressBar(-1);
  }

  async function openReleasesPage(): Promise<void> {
    await shell.openExternal(releasesUrl);
  }

  registerWindowsUpdateEvents(updater, state, options, showMessageBox, clearProgressBar, setProgressBar);

  async function checkForUpdates(origin: UpdateCheckOrigin = "manual"): Promise<void> {
    if (activeCheck) {
      if (origin === "manual") {
        await showMessageBox({
          type: "info",
          buttons: ["OK"],
          defaultId: 0,
          cancelId: 0,
          title: "Updates",
          message: "Meowbert is already checking for updates.",
          detail: "Please wait a moment and try again if nothing happens."
        });
      }
      return activeCheck;
    }

    state.manualDownloadPending = false;
    state.currentOrigin = origin;
    activeCheck = updater.checkForUpdates()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        activeCheck = null;
        state.currentOrigin = null;
      });
    return activeCheck;
  }

  backgroundTimeout = setTimeout(() => {
    void checkForUpdates("background");
    backgroundInterval = setInterval(() => {
      void checkForUpdates("background");
    }, BACKGROUND_UPDATE_CHECK_INTERVAL_MS);
  }, BACKGROUND_UPDATE_CHECK_DELAY_MS);

  app.on("before-quit", () => {
    if (backgroundTimeout) {
      clearTimeout(backgroundTimeout);
    }
    if (backgroundInterval) {
      clearInterval(backgroundInterval);
    }
  });

  return {
    supportsAutomaticUpdates: true,
    checkForUpdates,
    openReleasesPage
  };
}
