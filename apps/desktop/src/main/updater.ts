import {
  BrowserWindow,
  app,
  dialog,
  shell,
  type MessageBoxOptions
} from "electron";
import electronUpdater, {
  type AppUpdater,
  type ProgressInfo,
  type UpdateInfo
} from "electron-updater";
import { formatDesktopVersion } from "./version";

const DEFAULT_DESKTOP_RELEASE_REPOSITORY = "XInTheDark/meowbert-ai-agent";
const { autoUpdater } = electronUpdater;
const DESKTOP_RELEASES_REPOSITORY = resolveDesktopReleaseRepository(import.meta.env.VITE_DESKTOP_RELEASE_REPOSITORY);
const DESKTOP_RELEASES_BASE_URL = `https://github.com/${DESKTOP_RELEASES_REPOSITORY}/releases`;
const DESKTOP_RELEASES_URL = resolveDesktopReleasesPageUrl(import.meta.env.VITE_DESKTOP_RELEASES_PAGE_URL, DESKTOP_RELEASES_BASE_URL);
const BACKGROUND_UPDATE_CHECK_DELAY_MS = 15_000;
const BACKGROUND_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type UpdateCheckOrigin = "background" | "manual";

export interface DesktopUpdater {
  supportsAutomaticUpdates: boolean;
  checkForUpdates: (origin?: UpdateCheckOrigin) => Promise<void>;
  openReleasesPage: () => Promise<void>;
}

interface DesktopUpdaterOptions {
  getOwnerWindow: () => BrowserWindow | null;
  focusMainWindow: () => void;
}

interface UpdateSupportMessage {
  message: string;
  detail: string;
}

function resolveDesktopReleaseRepository(value: string | undefined): string {
  const candidate = value?.trim();
  if (candidate && /^[^/\s]+\/[^/\s]+$/.test(candidate)) {
    return candidate;
  }
  return DEFAULT_DESKTOP_RELEASE_REPOSITORY;
}

function resolveDesktopReleasesPageUrl(value: string | undefined, fallbackUrl: string): string {
  const candidate = value?.trim();
  if (!candidate) {
    return fallbackUrl;
  }

  try {
    return new URL(candidate).toString();
  } catch {
    return fallbackUrl;
  }
}

function supportsAutomaticUpdates(): boolean {
  return app.isPackaged && process.platform === "win32";
}

function buildUpdateSupportMessage(): UpdateSupportMessage {
  if (!app.isPackaged) {
    return {
      message: "Auto-updates work only in packaged desktop releases.",
      detail: "Use GitHub Releases while developing locally."
    };
  }

  if (process.platform === "darwin") {
    return {
      message: "Automatic updates are not enabled for macOS preview builds yet.",
      detail: "Meowbert can ship unsigned universal downloads today, but in-app macOS updates need Apple signing and notarization first."
    };
  }

  return {
    message: "Automatic updates are not supported on this platform yet.",
    detail: "Open GitHub Releases to download the newest build manually."
  };
}

function currentDisplayVersion(): string {
  return formatDesktopVersion(app.getVersion());
}

function updateDisplayVersion(info: UpdateInfo): string {
  return formatDesktopVersion(info.version);
}

export function createDesktopUpdater(options: DesktopUpdaterOptions): DesktopUpdater {
  const updater = autoUpdater as AppUpdater;
  const automaticUpdatesSupported = supportsAutomaticUpdates();
  let activeCheck: Promise<void> | null = null;
  let currentOrigin: UpdateCheckOrigin | null = null;
  let backgroundTimeout: NodeJS.Timeout | null = null;
  let backgroundInterval: NodeJS.Timeout | null = null;
  let lastDownloadedVersionPrompted: string | null = null;
  let manualDownloadPending = false;

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
    await shell.openExternal(DESKTOP_RELEASES_URL);
  }

  updater.on("update-available", (info: UpdateInfo) => {
    if (currentOrigin !== "manual") {
      return;
    }

    manualDownloadPending = true;
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
    manualDownloadPending = false;
    if (currentOrigin !== "manual") {
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
    manualDownloadPending = false;
    if (lastDownloadedVersionPrompted === info.version) {
      return;
    }
    lastDownloadedVersionPrompted = info.version;

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
    const shouldNotifyUser = currentOrigin === "manual" || manualDownloadPending;
    manualDownloadPending = false;
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

  async function checkForUpdates(origin: UpdateCheckOrigin = "manual"): Promise<void> {
    if (!automaticUpdatesSupported) {
      if (origin === "manual") {
        const supportMessage = buildUpdateSupportMessage();
        const result = await showMessageBox({
          type: "info",
          buttons: ["Open Releases", "OK"],
          defaultId: 0,
          cancelId: 1,
          title: "Updates",
          message: supportMessage.message,
          detail: supportMessage.detail
        });
        if (result.response === 0) {
          await openReleasesPage();
        }
      }
      return;
    }

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

    manualDownloadPending = false;
    currentOrigin = origin;
    activeCheck = updater.checkForUpdates()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        activeCheck = null;
        currentOrigin = null;
      });
    return activeCheck;
  }

  if (automaticUpdatesSupported) {
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
  }

  return {
    supportsAutomaticUpdates: automaticUpdatesSupported,
    checkForUpdates,
    openReleasesPage
  };
}
