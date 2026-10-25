import { beforeEach, expect, it, vi } from "vitest";
import type { DesktopLocalExecutorOptions } from "./local-executor";

const state = vi.hoisted(() => ({ options: null as DesktopLocalExecutorOptions | null, server: "https://server.test", start: vi.fn(), check: vi.fn(), stop: vi.fn() }));
vi.mock("electron", () => ({ app: { getPath: () => "/owned", getAppPath: () => "/app", getVersion: () => "1", isPackaged: false }, dialog: {} }));
vi.mock("../state", () => ({ readBootstrapData: async () => ({ token: "user",
  localExecutionSettings: { enabled: true, storageRoot: "/mount", workspaceRoots: {}, serverBaseUrl: state.server } }),
  saveLocalExecutionSettings: vi.fn(), listLocalExecutionDeviceIds: async () => [] }));
vi.mock("../live-folders/manager", () => ({ LiveFolderManager: class {} }));
vi.mock("../live-folders/native-mount", () => ({ cleanupLiveFolderMounts: vi.fn() }));
vi.mock("../live-folders/consent", () => ({ confirmLiveFolderConsent: vi.fn() }));
vi.mock("../sandbox-image/resources", () => ({ stopDesktopContainers: vi.fn() }));
vi.mock("../sandbox-image/history", () => ({ readSandboxHistory: vi.fn() }));
vi.mock("../sandbox-image/download-size", () => ({ sandboxDownloadSize: vi.fn() }));
vi.mock("./host-processes", () => ({ cleanupHostProcesses: vi.fn() }));
vi.mock("./local-executor", () => ({ startDesktopLocalExecutor: state.start }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); state.server = "https://server.test";
  state.start.mockImplementation(async (options: DesktopLocalExecutorOptions) => {
    state.options = options;
    options.onStatus?.({ state: "running", message: "Ready for local tasks", hostReady: true, sandboxReady: true });
    return { checkForUpdates: state.check, stop: state.stop };
  });
  state.check.mockImplementation(async () => {
    state.options!.onStatus?.({ state: "checking", message: "Checking sandbox and storage…" });
    state.options!.onStatus?.({ state: "running", message: "Ready for local tasks", hostReady: true, sandboxReady: true });
  });
});

it("preserves a task startup failure across sandbox refresh until that task starts successfully", async () => {
  const lifecycle = await import("./lifecycle");
  await lifecycle.startConfiguredLocalExecutor();
  const run = { taskId: "task", runId: "run" };
  state.options!.onPendingReason?.("Project folder is unavailable", run);
  const refreshed = await lifecycle.checkLocalExecutionUpdates();
  expect(refreshed.runIssues).toEqual([{ ...run, message: "Project folder is unavailable" }]);
  expect(refreshed.hostReady).toBe(true);
  expect(refreshed.sandboxReady).toBe(true);
  state.options!.onRunStarted?.("another-task");
  expect(lifecycle.getLocalExecutionStatus().runIssues).toHaveLength(1);
  state.options!.onRunStarted?.(run.taskId);
  expect(lifecycle.getLocalExecutionStatus().runIssues).toEqual([]);
  await lifecycle.stopLocalExecutor();
});

it("keeps failures scoped to their tasks and clears them when switching servers", async () => {
  const lifecycle = await import("./lifecycle");
  await lifecycle.startConfiguredLocalExecutor();
  state.options!.onPendingReason?.("Missing inputs", { taskId: "task-a", runId: "run-a" });
  state.options!.onPendingReason?.("Missing project", { taskId: "task-b", runId: "run-b" });
  state.options!.onRunStarted?.("task-a");
  expect(lifecycle.getLocalExecutionStatus().runIssues).toEqual([{ taskId: "task-b", runId: "run-b", message: "Missing project" }]);
  state.server = "https://other.test";
  await lifecycle.startConfiguredLocalExecutor();
  expect(lifecycle.getLocalExecutionStatus().runIssues).toEqual([]);
  await lifecycle.stopLocalExecutor();
});
