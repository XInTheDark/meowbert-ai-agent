/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import { DEFAULT_DESKTOP_SHORTCUT_PREFERENCES } from "../../desktop/desktopShortcuts";
import type { DesktopLocalExecutionSettings } from "../../desktop/platform";
import { DesktopPreferencesPage } from "./DesktopPreferencesPage";

vi.mock("../../contexts/AppRuntimeContext", () => ({ useAppRuntime: vi.fn() }));

const initialSettings: DesktopLocalExecutionSettings = {
  enabled: true,
  maxConcurrentRuns: 2,
  storageBackendId: "server-storage",
  storageRoot: "/Volumes/Shared/Meowbert",
  workspaceRoots: { workspace: "/Volumes/Shared/Workspace" },
  deviceId: "saved-device",
  serverBaseUrl: "https://server.example.com",
  downloadConsent: true,
  defaultMode: "sandbox",
  hostConsent: false,
  hostShellEnabled: false,
  computerUseEnabled: false,
  hostBrowserEnabled: false,
  liveDriveEnabled: true,
  liveDriveConsents: { connection: true }
};
const computerStatus = {
  available: true,
  canControlComputer: false,
  canTakeScreenshot: false,
  permissions: { accessibility: "denied", screenRecording: "denied" }
};
const platform = {
  getBootstrapData: vi.fn(),
  getLocalExecutionStatus: vi.fn(),
  saveLocalExecutionSettings: vi.fn(),
  pickLocalExecutionStorageRoot: vi.fn(),
  retryLocalExecution: vi.fn(),
  checkSandboxUpdates: vi.fn(),
  onLocalExecutionStatusChanged: vi.fn(),
  getComputerStatus: vi.fn(),
  requestAccessibilityPermission: vi.fn(),
  openScreenRecordingSettings: vi.fn(),
  showQuickAgent: vi.fn()
};
const saveShortcutPreferences = vi.fn();
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  platform.onLocalExecutionStatusChanged.mockReturnValue(() => {});
  platform.getBootstrapData.mockResolvedValue({ localExecutionSettings: { ...initialSettings } });
  platform.getLocalExecutionStatus.mockResolvedValue({ state: "running", message: null });
  platform.saveLocalExecutionSettings.mockImplementation(async (settings) => settings);
  platform.getComputerStatus.mockResolvedValue(computerStatus);
  platform.requestAccessibilityPermission.mockResolvedValue({ ...computerStatus, canControlComputer: true });
  platform.openScreenRecordingSettings.mockResolvedValue({ ok: true });
  saveShortcutPreferences.mockResolvedValue(undefined);
  vi.mocked(useAppRuntime).mockReturnValue({
    capabilities: { isDesktop: true, supportsComputerUse: true },
    platform,
    activeContext: { workspaceId: "workspace", environmentId: "project" },
    activeServerProfile: { baseUrl: initialSettings.serverBaseUrl },
    shortcutPreferences: { ...DEFAULT_DESKTOP_SHORTCUT_PREFERENCES, newTask: "Alt+N" },
    saveShortcutPreferences
  } as never);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderPage() {
  await act(async () => root.render(<MemoryRouter><DesktopPreferencesPage /></MemoryRouter>));
}

function button(label: string) {
  const match = Array.from(container.querySelectorAll("button")).find((element) => (element.getAttribute("aria-label") ?? element.textContent?.trim()) === label);
  if (!match) throw new Error("Button not found: " + label);
  return match;
}

async function click(label: string) {
  await act(async () => button(label).click());
}

function input(label: string) {
  const match = Array.from(container.querySelectorAll("label")).find((element) => element.textContent === label);
  if (!match?.control) throw new Error("Input not found: " + label);
  return match.control as HTMLInputElement;
}

async function pressKey(key: string, modifiers: KeyboardEventInit = {}) {
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers })); });
}

describe("desktop preferences navigation and shortcuts", () => {
  it("returns to the active project and gates computer permissions by desktop capability", async () => {
    const runtime = vi.mocked(useAppRuntime).getMockImplementation()!();
    vi.mocked(useAppRuntime).mockReturnValue({ ...runtime, capabilities: { ...runtime.capabilities, supportsComputerUse: false } });
    await renderPage();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/app/workspace/projects/project");
    expect(container.querySelector("nav")?.textContent).not.toContain("Computer use");
    expect(platform.getComputerStatus).not.toHaveBeenCalled();
  });

  it("records a shortcut while preserving the other saved bindings", async () => {
    await renderPage();
    await click("In app");
    await click("Change Command Palette shortcut");
    await pressKey("j", { ctrlKey: true, shiftKey: true });
    expect(saveShortcutPreferences).toHaveBeenCalledWith({ ...DEFAULT_DESKTOP_SHORTCUT_PREFERENCES, newTask: "Alt+N", commandPalette: "CommandOrControl+Shift+J" });
  });

  it("cancels with Escape, clears with Delete, and stops recording when leaving the section", async () => {
    await renderPage();
    await click("Change Quick Agent shortcut");
    await pressKey("Escape");
    expect(saveShortcutPreferences).not.toHaveBeenCalled();
    await click("Change Quick Agent shortcut");
    await pressKey("Delete");
    expect(saveShortcutPreferences).toHaveBeenCalledWith(expect.objectContaining({ quickAgent: null, newTask: "Alt+N" }));
    saveShortcutPreferences.mockClear();
    await click("Change Quick Agent shortcut");
    await click("Local execution");
    await pressKey("j", { ctrlKey: true });
    expect(saveShortcutPreferences).not.toHaveBeenCalled();
  });

  it("resets all bindings and opens Quick Agent", async () => {
    await renderPage();
    await click("Reset defaults");
    expect(saveShortcutPreferences).toHaveBeenCalledWith(DEFAULT_DESKTOP_SHORTCUT_PREFERENCES);
    await click("Open Quick Agent");
    expect(platform.showQuickAgent).toHaveBeenCalledOnce();
  });
});

describe("local execution preferences", () => {
  it("saves an edited switch without losing storage roots, device identity, or consents", async () => {
    await renderPage();
    await click("Local execution");
    expect(input("Host shell").disabled).toBe(true);
    await act(async () => input("Computer use").click());
    await click("Save changes");
    expect(platform.saveLocalExecutionSettings).toHaveBeenCalledWith({ ...initialSettings, computerUseEnabled: true });
    expect(container.textContent).toContain("Preferences saved.");
  });

  it("clears Drive consents only when live folders are turned off", async () => {
    await renderPage();
    await click("Local execution");
    await act(async () => input("Live Drive folders").click());
    await click("Save changes");
    expect(platform.saveLocalExecutionSettings).toHaveBeenCalledWith({ ...initialSettings, liveDriveEnabled: false, liveDriveConsents: {} });
  });

  it("requires storage before enabling execution and saves a folder selected by the native picker", async () => {
    platform.getBootstrapData.mockResolvedValue({ localExecutionSettings: { ...initialSettings, storageRoot: null, workspaceRoots: {} } });
    platform.pickLocalExecutionStorageRoot.mockResolvedValue("/Volumes/New storage");
    await renderPage();
    await click("Local execution");
    expect(button("Save changes").disabled).toBe(true);
    await click("Choose folder");
    expect(button("Save changes").disabled).toBe(false);
    await click("Save changes");
    expect(platform.saveLocalExecutionSettings).toHaveBeenCalledWith({ ...initialSettings, storageRoot: "/Volumes/New storage", workspaceRoots: {} });
  });

  it("accepts existing workspace roots and reports save errors", async () => {
    platform.getBootstrapData.mockResolvedValue({ localExecutionSettings: { ...initialSettings, storageRoot: null } });
    platform.saveLocalExecutionSettings.mockRejectedValue(new Error("Storage is unavailable"));
    await renderPage();
    await click("Local execution");
    expect(button("Save changes").disabled).toBe(false);
    await click("Save changes");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Storage is unavailable");
  });

  it("retries the connection and updates its visible status", async () => {
    platform.checkSandboxUpdates.mockResolvedValue({ state: "error", message: "Docker is not running" });
    await renderPage();
    await click("Local execution");
    await click("Check for sandbox updates");
    expect(platform.checkSandboxUpdates).toHaveBeenCalledOnce();
    expect(platform.retryLocalExecution).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Docker is not running");
  });
  it("keeps task startup failures visible after refresh without blaming a ready sandbox", async () => {
    const status = { state: "running", message: "Ready for local tasks", hostReady: true, sandboxReady: true,
      runIssues: [{ taskId: "task", runId: "run", message: "Waiting for storage: project folder is unavailable" }] };
    platform.getLocalExecutionStatus.mockResolvedValue(status);
    platform.checkSandboxUpdates.mockResolvedValue(status);
    await renderPage(); await click("Local execution");
    await click("Check for sandbox updates");
    const text = container.querySelector('[role="status"]')?.textContent;
    expect(text).toContain("Task startup needs attention");
    expect(text).toContain("project folder is unavailable");
    expect(text).not.toContain("Sandbox needs attention");
    expect(text).not.toContain("Ready for local tasks");
    expect(container.querySelector('[data-state="error"]')).not.toBeNull();
  });
  it("does not label a general execution error as a sandbox failure when the sandbox is ready", async () => {
    platform.getLocalExecutionStatus.mockResolvedValue({ state: "error", hostReady: true, sandboxReady: true, message: "Storage unavailable" });
    await renderPage(); await click("Local execution");
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Local execution needs attention");
    expect(container.textContent).not.toContain("Sandbox needs attention");
  });
  it("receives pushed status and timestamps without polling, and unsubscribes", async () => {
    vi.useFakeTimers();
    const unsubscribe = vi.fn();
    platform.onLocalExecutionStatusChanged.mockReturnValue(unsubscribe);
    try {
      await renderPage(); await click("Local execution");
      const listener = platform.onLocalExecutionStatusChanged.mock.calls[0][0];
      await act(async () => listener({state:"downloading",message:"Downloading sandbox update…",sandbox:{image:"registry/image@sha256:abc",digest:"sha256:abc",lastCheckedAt:"2026-10-25T01:00:00Z",lastUpdatedAt:null}}));
      expect(container.textContent).toContain("Downloading sandbox…");
      expect(container.textContent).toContain("registry/image@sha256:abc");
      expect(container.querySelector('[data-state="running"]')).toBeNull();
      expect(container.textContent).toContain("Not recorded");
      await act(async () => vi.advanceTimersByTimeAsync(120_000));
      expect(platform.getLocalExecutionStatus).toHaveBeenCalledOnce();
      await click("Shortcuts");
      expect(unsubscribe).toHaveBeenCalledOnce();
    } finally { vi.useRealTimers(); }
  });

});

describe("computer use permissions", () => {
  it("keeps native permission actions and status refresh available", async () => {
    await renderPage();
    await click("Computer use");
    await click("Enable");
    expect(platform.requestAccessibilityPermission).toHaveBeenCalledOnce();
    await click("Open settings");
    expect(platform.openScreenRecordingSettings).toHaveBeenCalledOnce();
    await click("Refresh");
    expect(platform.getComputerStatus).toHaveBeenCalledTimes(2);
  });
});
