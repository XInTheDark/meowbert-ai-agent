import { dialog, shell } from "electron";
import { updater } from "electron-sparkle";
import type { DesktopUpdater, DesktopUpdaterOptions } from "./updater";

export function createSparkleDesktopUpdater(options: DesktopUpdaterOptions, releasesUrl: string): DesktopUpdater {
  updater.on("error", ({ error }) => console.error("Sparkle updater error", error));
  updater.setBeforeRelaunchHandler(options.prepareForRelaunch);
  const ready = updater.start();
  void ready.catch((error) => console.error("Sparkle startup failed", error));

  return {
    supportsAutomaticUpdates: true,
    openReleasesPage: async () => { await shell.openExternal(releasesUrl); },
    async checkForUpdates(origin = "manual") {
      try {
        await ready;
        if (origin === "background") {
          if (updater.getState().canCheckForUpdates) updater.checkForUpdatesInBackground();
        } else {
          options.focusMainWindow();
          updater.checkForUpdates();
        }
      } catch (error) {
        if (origin !== "manual") return;
        const message = {
          type: "error" as const,
          title: "Update check failed",
          message: "Meowbert could not start the updater.",
          detail: error instanceof Error ? error.message : String(error)
        };
        const owner = options.getOwnerWindow();
        if (owner) await dialog.showMessageBox(owner, message);
        else await dialog.showMessageBox(message);
      }
    }
  };
}
