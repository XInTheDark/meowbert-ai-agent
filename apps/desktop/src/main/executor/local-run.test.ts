import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ bootstrap: vi.fn(), call: vi.fn(), wait: vi.fn(), run: vi.fn(), stop: vi.fn(),
  verifyStorage: vi.fn(),
  remotePresence: vi.fn(), remoteAction: vi.fn(), localPresence: vi.fn(), localAction: vi.fn() }));
vi.mock("@meowbert/run-executor/agent/index", () => ({ runAgentJob: state.run }));
vi.mock("@meowbert/run-executor/run-api/client", () => ({ createRunApiClient: () => ({ call: state.call }) }));
vi.mock("@meowbert/run-executor/run-api/http-run-control", () => ({ createHttpRunControl: () => ({ bootstrap: state.bootstrap,
  platform: { getDesktopComputerPresence: state.remotePresence, requestDesktopComputerAction: state.remoteAction }, stop: state.stop }) }));
vi.mock("@meowbert/run-executor/run-api/proxy-model-gateway", () => ({ createProxyModelGateway: () => ({}) }));
vi.mock("../storage/roots", () => ({ verifyMountedStorage: state.verifyStorage, resolveVerifiedStoragePath: async () => "/mount/project" }));
vi.mock("../storage/inputs", async () => ({ ...await vi.importActual<typeof import("../storage/inputs")>("../storage/inputs"), waitForRunInputs: state.wait }));
vi.mock("./sandbox-machine-host", () => ({ createDesktopSandboxMachineProvider: () => ({}), probeDesktopSandboxStorage: async () => {} }));
vi.mock("./local-run-paths", () => ({ localRunRelocationNote: async () => undefined }));
vi.mock("../computer", () => ({ getComputerUseStatus: state.localPresence }));
vi.mock("../computer-use/service", () => ({ computerUseService: { performAction: state.localAction, release: vi.fn() } }));
import { startLocalRun } from "./local-run";
import { StorageNotReadyError } from "../storage/inputs";
import type { DesktopLocalExecutorOptions } from "./local-executor";
import { configureLocalRunPlatform } from "./local-run-platform";

beforeEach(() => {
  vi.clearAllMocks();
  state.verifyStorage.mockResolvedValue({ ok: true });
  state.bootstrap.mockResolvedValue({ roots: { storageBackendId: "backend", envRootRelative: "project", workspaceRootRelative: "workspace" },
    snapshot: { task: { task_root_path: ".meowbert/task-runs/task" } }, inputs: [{ relativePath: "inputs/file", sizeBytes: 5, sha256: "digest" }] });
});
it.each([false, true])("refuses admission immediately when storage disappears before claim, throws=%s", async (throws) => {
  if (throws) state.verifyStorage.mockRejectedValueOnce(Object.assign(new Error("Gone"), { code: "ENOENT" }));
  else state.verifyStorage.mockResolvedValueOnce({ ok: false });
  const api = { request: vi.fn().mockResolvedValue({ pending: true }) };
  const options = { scratchRoot: "/tmp/meowbert-test-scratch", resourcesRoot: "/tmp/meowbert-test-resources",
    storageBackendId: "backend", storageRoot: "/mount", apiBaseUrl: "https://server.test", deviceId: "device", onPendingReason: vi.fn() } as unknown as DesktopLocalExecutorOptions;
  await startLocalRun(options, api as never, { run_id: "run", queue_state: "admitted", payload_json: {} as never },
    "image", "/skills", {} as never, "install").done;
  expect(api.request).toHaveBeenCalledExactlyOnceWith("/api/devices/device/runs/run/refuse-storage", "POST", {});
  expect(state.bootstrap).not.toHaveBeenCalled();
  expect(state.run).not.toHaveBeenCalled();
  expect(state.call).not.toHaveBeenCalled();
  expect(options.onPendingReason).toHaveBeenCalledWith(expect.stringContaining("Waiting for storage"));
});
it("releases invisible inputs to pending without starting or failing the run", async () => {
  state.wait.mockRejectedValue(new StorageNotReadyError("waiting for storage"));
  const api = { request: vi.fn().mockResolvedValue({ token: "lease" }) };
  const options = { scratchRoot: "/tmp/meowbert-test-scratch", resourcesRoot: "/tmp/meowbert-test-resources", storageBackendId: "backend", storageRoot: "/mount", apiBaseUrl: "https://server.test", deviceId: "device", onPendingReason: vi.fn() } as unknown as DesktopLocalExecutorOptions;
  await startLocalRun(options, api as never, { run_id: "run", queue_state: "admitted", payload_json: {} as never }, "image", "/skills", { skills: {} } as never, "install").done;
  expect(state.call).toHaveBeenCalledExactlyOnceWith("control.releaseForStorage", []);
  expect(state.run).not.toHaveBeenCalled();
  expect(options.onPendingReason).toHaveBeenCalledWith("waiting for storage");
});

it.each([false, true])("keeps local Computer Use on the device when enabled=%s", async (enabled) => {
  state.wait.mockResolvedValue(undefined);
  const status = { available: true, canTakeScreenshot: true, canControlComputer: true };
  state.localPresence.mockResolvedValue(status);
  state.localAction.mockResolvedValue({ ok: true });
  const action = { toolName: "computer_screenshot", args: {} };
  state.run.mockImplementationOnce(async (_job, env) => {
    const platform = env.control.platform;
    expect(await platform.getDesktopComputerPresence()).toEqual(enabled ? { status } : null);
    if (enabled) {
      expect(await platform.requestDesktopComputerAction(action)).toEqual({ ok: true });
      expect(state.localAction).toHaveBeenCalledWith({ ...action, taskId: "task" });
    } else {
      await expect(platform.requestDesktopComputerAction(action)).rejects.toThrow("disabled");
      expect(state.localPresence).not.toHaveBeenCalled();
      expect(state.localAction).not.toHaveBeenCalled();
    }
  });
  const options = { scratchRoot: "/tmp/meowbert-test-scratch", resourcesRoot: "/tmp/meowbert-test-resources",
    storageBackendId: "backend", storageRoot: "/mount", apiBaseUrl: "https://server.test", deviceId: "device",
    computerUseEnabled: enabled } as unknown as DesktopLocalExecutorOptions;
  const api = { request: vi.fn().mockResolvedValue({ token: "lease" }) };
  await startLocalRun(options, api as never, { run_id: "run", queue_state: "admitted", payload_json: { taskId: "task" } as never },
    "image", "/skills", { skills: {} } as never, "install").done;
  expect(state.run).toHaveBeenCalledOnce();
  expect(state.remotePresence).not.toHaveBeenCalled();
  expect(state.remoteAction).not.toHaveBeenCalled();
});

it("maps native Drive paths back to task-scoped search and status without exposing server paths", async () => {
  const search = vi.fn().mockResolvedValue({ folder: "context/Drive/sub", items: [{ path: "context/Drive/sub/file.txt" }] });
  const status = vi.fn().mockResolvedValue({ status: "synced" });
  const platform = { liveSyncFolderSearch: search, liveSyncStatus: status };
  configureLocalRunPlatform({ platform, options: {}, taskId: "task", signal: new AbortController().signal,
    bootstrap: { liveSyncFiles: [{ id: "link", taskRelativePath: "context/Drive" }] },
    liveSyncFiles: [{ id: "link", taskRelativePath: "/owned/live/Drive" }] } as never);
  const request = { taskRelativePath: "/owned/live/Drive", subfolder: "sub" };
  expect(await platform.liveSyncFolderSearch(request)).toEqual({ folder: "/owned/live/Drive/sub", items: [{ path: "/owned/live/Drive/sub/file.txt" }] });
  expect(search).toHaveBeenCalledWith({ ...request, taskRelativePath: "context/Drive" });
  await platform.liveSyncStatus({ taskRelativePath: "/owned/live/Drive" });
  expect(status).toHaveBeenCalledWith({ taskRelativePath: "context/Drive" });
});
