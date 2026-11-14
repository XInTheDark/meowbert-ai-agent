import { app, BrowserWindow, dialog, shell } from "electron";
import { createSparkleDesktopUpdater } from "./sparkle-updater";
import { createWindowsDesktopUpdater } from "./windows-updater";

const DEFAULT_DESKTOP_RELEASE_REPOSITORY = "XInTheDark/meowbert-ai-agent";
const DESKTOP_RELEASES_REPOSITORY = resolveDesktopReleaseRepository(import.meta.env.VITE_DESKTOP_RELEASE_REPOSITORY);
const DESKTOP_RELEASES_BASE_URL = `https://github.com/${DESKTOP_RELEASES_REPOSITORY}/releases`;
const DESKTOP_RELEASES_URL = resolveDesktopReleasesPageUrl(import.meta.env.VITE_DESKTOP_RELEASES_PAGE_URL, DESKTOP_RELEASES_BASE_URL);

export type UpdateCheckOrigin = "background" | "manual";

export interface DesktopUpdater {
  supportsAutomaticUpdates: boolean;
  checkForUpdates: (origin?: UpdateCheckOrigin) => Promise<void>;
  openReleasesPage: () => Promise<void>;
}

export interface DesktopUpdaterOptions {
  getOwnerWindow: () => BrowserWindow | null;
  focusMainWindow: () => void;
  prepareForRelaunch: () => Promise<void>;
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

export function createDesktopUpdater(options: DesktopUpdaterOptions): DesktopUpdater {
  if (app.isPackaged && process.platform === "darwin") {
    return createSparkleDesktopUpdater(options, DESKTOP_RELEASES_URL);
  }
  if (app.isPackaged && process.platform === "win32") {
    return createWindowsDesktopUpdater(options, DESKTOP_RELEASES_URL);
  }
  return {
    supportsAutomaticUpdates: false,
    openReleasesPage: async () => { await shell.openExternal(DESKTOP_RELEASES_URL); },
    async checkForUpdates(origin = "manual") {
      if (origin !== "manual") return;
      const message = {
        type: "info" as const, buttons: ["Open Releases", "OK"], defaultId: 0, cancelId: 1, title: "Updates",
        message: app.isPackaged ? "Automatic updates are not supported on this platform yet." : "Auto-updates work only in packaged desktop releases.",
        detail: "Open GitHub Releases to download the newest build manually."
      };
      const owner = options.getOwnerWindow();
      const result = owner ? await dialog.showMessageBox(owner, message) : await dialog.showMessageBox(message);
      if (result.response === 0) await shell.openExternal(DESKTOP_RELEASES_URL);
    }
  };
}
