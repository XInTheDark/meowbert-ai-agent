import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ bootstrap: vi.fn(), call: vi.fn(), wait: vi.fn(), run: vi.fn(), stop: vi.fn() }));
vi.mock("@meowbert/run-executor/agent/index", () => ({ runAgentJob: state.run }));
vi.mock("@meowbert/run-executor/run-api/client", () => ({ createRunApiClient: () => ({ call: state.call }) }));
vi.mock("@meowbert/run-executor/run-api/http-run-control", () => ({ createHttpRunControl: () => ({ bootstrap: state.bootstrap, platform: {}, stop: state.stop }) }));
vi.mock("@meowbert/run-executor/run-api/proxy-model-gateway", () => ({ createProxyModelGateway: () => ({}) }));
vi.mock("../storage/roots", () => ({ verifyMountedStorage: async () => ({ ok: true }), resolveVerifiedStoragePath: async () => "/mount/project" }));
vi.mock("../storage/inputs", async () => ({ ...await vi.importActual<typeof import("../storage/inputs")>("../storage/inputs"), waitForRunInputs: state.wait }));
vi.mock("./sandbox-machine-host", () => ({ createDesktopSandboxMachineProvider: () => ({}), probeDesktopSandboxStorage: async () => {} }));
import { startLocalRun } from "./local-run";
import { StorageNotReadyError } from "../storage/inputs";
import type { DesktopLocalExecutorOptions } from "./local-executor";

beforeEach(() => {
  vi.clearAllMocks();
  state.bootstrap.mockResolvedValue({ roots: { storageBackendId: "backend", envRootRelative: "project", workspaceRootRelative: "workspace" },
    snapshot: { task: { task_root_path: ".meowbert/task-runs/task" } }, inputs: [{ relativePath: "inputs/file", sizeBytes: 5, sha256: "digest" }] });
});
it("releases invisible inputs to pending without starting or failing the run", async () => {
  state.wait.mockRejectedValue(new StorageNotReadyError("waiting for storage"));
  const api = { request: vi.fn().mockResolvedValue({ token: "lease" }) };
  const options = { storageBackendId: "backend", storageRoot: "/mount", apiBaseUrl: "https://server.test", deviceId: "device", onPendingReason: vi.fn() } as unknown as DesktopLocalExecutorOptions;
  await startLocalRun(options, api as never, { run_id: "run", queue_state: "admitted", payload_json: {} as never }, "image", "/skills", { skills: {} } as never, "install").done;
  expect(state.call).toHaveBeenCalledExactlyOnceWith("control.releaseForStorage", []);
  expect(state.run).not.toHaveBeenCalled();
  expect(options.onPendingReason).toHaveBeenCalledWith("waiting for storage");
});
