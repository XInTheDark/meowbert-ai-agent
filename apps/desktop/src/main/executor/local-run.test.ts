import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ bootstrap: vi.fn(), call: vi.fn(), wait: vi.fn(), run: vi.fn(), stop: vi.fn(),
  verifyStorage: vi.fn(), resolveStoragePath: vi.fn(), sandboxProvider: vi.fn(), emit: vi.fn(), setStatus: vi.fn(),
  remotePresence: vi.fn(), remoteAction: vi.fn(), localPresence: vi.fn(), localAction: vi.fn() }));
vi.mock("@meowbert/run-executor/agent/index", () => ({ runAgentJob: state.run }));
vi.mock("@meowbert/run-executor/run-api/client", () => ({ createRunApiClient: () => ({ call: state.call }) }));
vi.mock("@meowbert/run-executor/run-api/http-run-control", () => ({ createHttpRunControl: () => ({ bootstrap: state.bootstrap,
  platform: { getDesktopComputerPresence: state.remotePresence, requestDesktopComputerAction: state.remoteAction },
  emitEvent: state.emit, setTaskStatus: state.setStatus, stop: state.stop }) }));
vi.mock("@meowbert/run-executor/run-api/proxy-model-gateway", () => ({ createProxyModelGateway: () => ({}) }));
vi.mock("../storage/roots", () => ({ verifyMountedStorage: state.verifyStorage, resolveVerifiedStoragePath: state.resolveStoragePath }));
vi.mock("../storage/inputs", async () => ({ ...await vi.importActual<typeof import("../storage/inputs")>("../storage/inputs"), waitForRunInputs: state.wait }));
vi.mock("./sandbox-machine-host", () => ({ createDesktopSandboxMachineProvider: state.sandboxProvider, probeDesktopSandboxStorage: async () => {} }));
vi.mock("./local-run-paths", () => ({ localRunRelocationNote: async () => undefined }));
vi.mock("../computer", () => ({ getComputerUseStatus: state.localPresence }));
vi.mock("../computer-use/service", () => ({ computerUseService: { performAction: state.localAction, release: vi.fn() } }));
import { startLocalRun } from "./local-run";
import { StorageNotReadyError } from "../storage/inputs";
import type { DesktopLocalExecutorOptions } from "./local-executor";
import { configureLocalRunPlatform } from "./local-run-platform";

const nativePlatform = process.platform;
afterEach(() => { Object.defineProperty(process, "platform", { value: nativePlatform }); });
beforeEach(() => {
  vi.clearAllMocks();
  state.run.mockReset();
  state.sandboxProvider.mockReturnValue({});
  state.verifyStorage.mockResolvedValue({ ok: true });
  state.resolveStoragePath.mockReset().mockResolvedValue("/mount/project");
  state.emit.mockResolvedValue(undefined);
  state.setStatus.mockResolvedValue(true);
  state.bootstrap.mockResolvedValue({ roots: { storageBackendId: "backend", envRootRelative: "project", workspaceRootRelative: "workspace" },
    snapshot: { task: { task_root_path: ".meowbert/task-runs/task" } }, inputs: [{ relativePath: "inputs/file", sizeBytes: 5, sha256: "digest" }] });
});
it.each([false, true])("keeps sandbox skills, scopes Drive mounts, and releases them after failure=%s", async (failure) => {
  Object.defineProperty(process, "platform", { value: "darwin" });
  state.wait.mockResolvedValue(undefined);
  const acquire = vi.fn().mockResolvedValue("/owned/mounts/attached");
  const release = vi.fn();
  const folder = { linkId: "attached", connectionId: "a".repeat(64), accountLabel: "owner", localRelativePath: "context/docs" };
  const bootstrap = await state.bootstrap();
  state.bootstrap.mockResolvedValueOnce({ ...bootstrap, liveSyncFiles: [{ id: "attached", provider: "google-drive",
    linkKind: "folder", taskRelativePath: "context/docs", localRelativePath: "context/docs" }] });
  state.run.mockImplementationOnce(async (_job, env) => {
    expect(env.settings.hostMode).toBe(false);
    expect(env.settings.skills.rootDir).toBe("/sandbox-skills");
    expect((await env.control.bootstrap()).liveSyncFiles[0].taskRelativePath).toBe("/owned/mounts/attached");
    if (failure) throw new StorageNotReadyError("Waiting for storage: live folder unavailable");
  });
  const options = { scratchRoot: "/tmp/meowbert-test-scratch", resourcesRoot: "/tmp/meowbert-test-resources",
    storageBackendId: "backend", storageRoot: "/mount", apiBaseUrl: "https://server.test", deviceId: "device",
    liveDriveEnabled: true, liveFolders: { acquire, release }, onLiveFolderConsent: vi.fn().mockResolvedValue(true),
    fetch: vi.fn(async (_url, init) => Response.json(init?.method === "POST" ? { ...folder, config: "private credential" } : { folders: [folder] }))
  } as unknown as DesktopLocalExecutorOptions;
  await startLocalRun(options, { request: vi.fn().mockResolvedValue({ token: "lease" }) } as never,
    { run_id: "run", queue_state: "admitted", payload_json: { taskId: "task", executionTarget: { kind: "local", mode: "sandbox" } } as never },
    "image", "/sandbox-skills", { skills: {} } as never, "install").done;
  expect(state.sandboxProvider).toHaveBeenCalledWith(expect.objectContaining({ liveFolderPaths: ["/owned/mounts/attached"], skillsRootDir: "/sandbox-skills" }));
  expect(release).toHaveBeenCalledWith(expect.stringMatching(/^run:/));
  if (failure) expect(state.call).toHaveBeenCalledWith("control.releaseForStorage", []);
  else expect(state.call).not.toHaveBeenCalled();
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
  expect(options.onPendingReason).toHaveBeenCalledWith(expect.stringContaining("Waiting for storage"), expect.objectContaining({ runId: "run" }));
});
it("releases invisible inputs to pending without starting or failing the run", async () => {
  state.wait.mockRejectedValue(new StorageNotReadyError("waiting for storage"));
  const api = { request: vi.fn().mockResolvedValue({ token: "lease" }) };
  const options = { scratchRoot: "/tmp/meowbert-test-scratch", resourcesRoot: "/tmp/meowbert-test-resources", storageBackendId: "backend", storageRoot: "/mount", apiBaseUrl: "https://server.test", deviceId: "device", onPendingReason: vi.fn() } as unknown as DesktopLocalExecutorOptions;
  await startLocalRun(options, api as never, { run_id: "run", queue_state: "admitted", payload_json: {} as never }, "image", "/skills", { skills: {} } as never, "install").done;
  expect(state.call).toHaveBeenCalledExactlyOnceWith("control.releaseForStorage", []);
  expect(state.run).not.toHaveBeenCalled();
  expect(options.onPendingReason).toHaveBeenCalledWith("waiting for storage", expect.objectContaining({ runId: "run" }));
});

it.each([false, true])("initializes the host project directory and clears issues only after running is accepted=%s", async (accepted) => {
  state.wait.mockResolvedValue(undefined);
  state.setStatus.mockResolvedValue(accepted);
  const onRunStarted = vi.fn();
  state.run.mockImplementationOnce(async (_job, env) => {
    await env.control.setTaskStatus("starting");
    expect(onRunStarted).not.toHaveBeenCalled();
    await env.control.setTaskStatus("running");
  });
  const options = { scratchRoot: "/tmp/meowbert-test-scratch", resourcesRoot: "/tmp/meowbert-test-resources",
    storageBackendId: "backend", storageRoot: "/mount", apiBaseUrl: "https://server.test", deviceId: "device",
    hostConsent: true, onRunStarted } as unknown as DesktopLocalExecutorOptions;
  await startLocalRun(options, { request: vi.fn().mockResolvedValue({ token: "lease" }) } as never,
    { run_id: "run", queue_state: "admitted", payload_json: { taskId: "task", executionTarget: { kind: "local", mode: "host" } } as never },
    "image", "/skills", { skills: {} } as never, "install").done;
  expect(state.resolveStoragePath).toHaveBeenCalledWith("/mount", "project", { createDirectory: true });
  if (accepted) expect(onRunStarted).toHaveBeenCalledExactlyOnceWith("task");
  else expect(onRunStarted).not.toHaveBeenCalled();
  expect(state.run).toHaveBeenCalledOnce();
});

it("records the exact unavailable folder in task events before releasing storage", async () => {
  state.resolveStoragePath.mockResolvedValueOnce("/mount/workspace")
    .mockRejectedValueOnce(Object.assign(new Error("Missing"), { code: "ENOENT", path: "/mount/project/root" }));
  const onPendingReason = vi.fn(), onRunStarted = vi.fn();
  const options = { scratchRoot: "/tmp/meowbert-test-scratch", resourcesRoot: "/tmp/meowbert-test-resources",
    storageBackendId: "backend", storageRoot: "/mount", apiBaseUrl: "https://server.test", deviceId: "device",
    onPendingReason, onRunStarted } as unknown as DesktopLocalExecutorOptions;
  await startLocalRun(options, { request: vi.fn().mockResolvedValue({ token: "lease" }) } as never,
    { run_id: "run", queue_state: "admitted", payload_json: { taskId: "task" } as never },
    "image", "/skills", { skills: {} } as never, "install").done;
  expect(state.emit).toHaveBeenCalledWith("log", { stage: "startup.storage", phase: "waiting",
    message: "Waiting for storage: project folder is unavailable (ENOENT): /mount/project/root" });
  expect(onPendingReason).toHaveBeenCalledWith(expect.stringContaining("/mount/project/root"), { taskId: "task", runId: "run" });
  expect(state.call).toHaveBeenCalledExactlyOnceWith("control.releaseForStorage", []);
  expect(onRunStarted).not.toHaveBeenCalled();
  expect(state.run).not.toHaveBeenCalled();
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
