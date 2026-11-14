import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  app: { isPackaged: true, getVersion: () => "2026.11.4", on: vi.fn() },
  showMessageBox: vi.fn(async () => ({ response: 1 })),
  openExternal: vi.fn(),
  getElectronUpdater: vi.fn(),
  electronUpdater: { on: vi.fn(), checkForUpdates: vi.fn(async () => null), quitAndInstall: vi.fn() },
  sparkle: {
    start: vi.fn(async () => {}), on: vi.fn(), setBeforeRelaunchHandler: vi.fn(),
    getState: vi.fn(() => ({ canCheckForUpdates: true })),
    checkForUpdates: vi.fn(), checkForUpdatesInBackground: vi.fn()
  }
}));

vi.mock("electron", () => ({
  app: mocks.app, BrowserWindow: class {},
  dialog: { showMessageBox: mocks.showMessageBox }, shell: { openExternal: mocks.openExternal }
}));
vi.mock("electron-updater", () => ({ default: {
  get autoUpdater() { mocks.getElectronUpdater(); return mocks.electronUpdater; }
} }));
vi.mock("electron-sparkle", () => ({ updater: mocks.sparkle }));

import { createDesktopUpdater } from "./updater";

const options = {
  getOwnerWindow: () => null, focusMainWindow: vi.fn(), prepareForRelaunch: vi.fn(async () => {})
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal("process", { ...process, platform: "darwin" });
  mocks.app.isPackaged = true;
  mocks.sparkle.start.mockResolvedValue();
  mocks.sparkle.getState.mockReturnValue({ canCheckForUpdates: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("uses Sparkle for packaged Macs without constructing the Squirrel updater", async () => {
  const desktop = createDesktopUpdater(options);
  expect(desktop.supportsAutomaticUpdates).toBe(true);
  await desktop.checkForUpdates();
  expect(mocks.sparkle.start).toHaveBeenCalledOnce();
  expect(mocks.sparkle.checkForUpdates).toHaveBeenCalledOnce();
  expect(options.focusMainWindow).toHaveBeenCalledOnce();
  expect(mocks.getElectronUpdater).not.toHaveBeenCalled();
});

it("waits for native startup before accepting a manual check", async () => {
  let finish!: () => void;
  mocks.sparkle.start.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
  const check = createDesktopUpdater(options).checkForUpdates();
  expect(mocks.sparkle.checkForUpdates).not.toHaveBeenCalled();
  finish();
  await check;
  expect(mocks.sparkle.checkForUpdates).toHaveBeenCalledOnce();
});

it("uses a silent background check and skips it while a session is active", async () => {
  const desktop = createDesktopUpdater(options);
  await desktop.checkForUpdates("background");
  mocks.sparkle.getState.mockReturnValue({ canCheckForUpdates: false });
  await desktop.checkForUpdates("background");
  expect(mocks.sparkle.checkForUpdatesInBackground).toHaveBeenCalledOnce();
  expect(mocks.sparkle.checkForUpdates).not.toHaveBeenCalled();
  expect(options.focusMainWindow).not.toHaveBeenCalled();
});

it("gives Sparkle the executor shutdown handler to finish before relaunch", async () => {
  createDesktopUpdater(options);
  const handler = mocks.sparkle.setBeforeRelaunchHandler.mock.calls[0][0];
  let finish!: () => void;
  options.prepareForRelaunch.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  let finished = false;
  const relaunch = handler().then(() => { finished = true; });
  await Promise.resolve();
  expect(finished).toBe(false);
  finish();
  await relaunch;
  expect(finished).toBe(true);
});

it("reports native startup failure on manual checks without falling back to Squirrel", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.sparkle.start.mockRejectedValue(new Error("Missing Sparkle framework"));
  const desktop = createDesktopUpdater(options);
  await desktop.checkForUpdates("background");
  expect(mocks.showMessageBox).not.toHaveBeenCalled();
  await desktop.checkForUpdates();
  expect(mocks.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({ detail: "Missing Sparkle framework" }));
  expect(mocks.getElectronUpdater).not.toHaveBeenCalled();
});

it("does not start Sparkle from an unpackaged development build", async () => {
  mocks.app.isPackaged = false;
  const desktop = createDesktopUpdater(options);
  expect(desktop.supportsAutomaticUpdates).toBe(false);
  await desktop.checkForUpdates();
  expect(mocks.sparkle.start).not.toHaveBeenCalled();
  expect(mocks.getElectronUpdater).not.toHaveBeenCalled();
  expect(mocks.electronUpdater.checkForUpdates).not.toHaveBeenCalled();
});

it("retains Windows checks, background scheduling, and install-and-relaunch", async () => {
  vi.stubGlobal("process", { ...process, platform: "win32" });
  const desktop = createDesktopUpdater(options);
  await desktop.checkForUpdates();
  expect(mocks.electronUpdater.checkForUpdates).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mocks.electronUpdater.checkForUpdates).toHaveBeenCalledTimes(2);
  expect(mocks.sparkle.start).not.toHaveBeenCalled();
  const downloaded = mocks.electronUpdater.on.mock.calls.find(([name]) => name === "update-downloaded")![1];
  mocks.showMessageBox.mockResolvedValueOnce({ response: 0 });
  downloaded({ version: "2026.11.5" });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.electronUpdater.quitAndInstall).toHaveBeenCalledOnce();
});
