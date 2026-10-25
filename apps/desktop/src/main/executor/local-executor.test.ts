import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  onEvent: null as null | ((event: string, data?: unknown) => void | Promise<void>), digest: "sha256:first", present: false, onRuns: null as null | ((runs: unknown[]) => void), request: vi.fn(),
  stream: vi.fn(), pull: vi.fn(), fence: vi.fn(), cleanup: vi.fn(), ping: vi.fn()
}));
vi.mock("../sandbox-image/manager", () => ({
  createDesktopDocker: () => ({ ping: state.ping, info: async () => ({ OSType: "linux" }) }), createDockerImageClient: () => ({}),
  pinnedImage: (image: { digest: string }) => "registry/image@" + image.digest,
  sandboxImagePresent: async () => state.present,
  ensureSandboxImage: state.pull
}));
vi.mock("../sandbox-image/history", () => ({readSandboxHistory:async()=>({image:null,digest:null,lastCheckedAt:null,lastUpdatedAt:null}),saveSandboxHistory:async()=>{}}));
vi.mock("../sandbox-image/cleanup", () => ({maintainDownloadedSandboxes:async()=>{}}));
vi.mock("../sandbox-image/resources", () => ({ prepareSandboxSkills: async () => "/skills", stopDesktopContainers: state.cleanup }));
vi.mock("./sandbox-machine-host", () => ({probeDesktopSandboxStorage:async()=>{}}));
vi.mock("../storage/roots", () => ({verifyMountedStorage:async () => ({ok:true})}));
vi.mock("./local-run", () => ({ startLocalRun: vi.fn(() => ({done:new Promise(() => {}),fence:state.fence})) }));
vi.mock("./device-api", async () => {
  const actual = await vi.importActual<typeof import("./device-api")>("./device-api");
  return { ...actual, createDeviceApi: (_options: unknown, signal: AbortSignal) => ({ request:state.request,
    stream: async (_route:string, onRuns:(runs:unknown[])=>void, onEvent:(event:string,data?:unknown)=>void | Promise<void>) => {
      state.stream(); state.onRuns = onRuns; state.onEvent = onEvent;
      if (state.stream.mock.calls.length === 1) throw new Error("connection lost");
      await onEvent("ready", { executionEventsVersion: 1 });
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), {once:true}));
    }
  }) };
});
import { startDesktopLocalExecutor } from "./local-executor";
import { startLocalRun } from "./local-run";
const options = {apiBaseUrl:"http://localhost:3000",token:"user",deviceId:"device",executorVersion:"1",storageBackendId:"backend",storageRoot:"/runtime",scratchRoot:"/scratch",resourcesRoot:"/resources",downloadConsent:false,maxConcurrentRuns:2};
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); state.present = false; state.digest = "sha256:first";
  state.pull.mockImplementation(async () => {state.present = true;});
  state.ping.mockResolvedValue(undefined); state.cleanup.mockResolvedValue(undefined);state.fence.mockResolvedValue(undefined);
  state.request.mockImplementation(async (route:string) => route.endsWith("/tombstones") ? { items: [] } : route.endsWith("/config") ? {enabled:true,storageMarkers:{backend:{installId:"install"}},sandboxImage:{reference:"registry/image:main",digest:state.digest},executorSettings:{}} : {});
});
afterEach(() => vi.useRealTimers());
describe.skipIf(process.platform !== "darwin" || process.arch !== "arm64")("desktop supervisor", () => {
  it("does not claim Host readiness when workspace storage has not verified", async () => {
    state.request.mockImplementation(async (route: string) => route.endsWith("/config")
      ? { enabled: true, storageMarkers: {}, sandboxImage: {}, executorSettings: {} }
      : route.endsWith("/tombstones") ? { items: [] } : {});
    const onPendingReason = vi.fn();
    const executor = await startDesktopLocalExecutor({ ...options, hostConsent: true, onPendingReason });
    await vi.advanceTimersByTimeAsync(11_000);
    expect(onPendingReason).toHaveBeenCalledWith("No verified workspace folder is available on this device.");
    expect(state.pull).not.toHaveBeenCalled();
    expect(startLocalRun).not.toHaveBeenCalled();
    await executor.stop();
  });
  it("keeps Host admission working when the pinned sandbox image lacks this platform", async () => {
    state.pull.mockRejectedValue(new Error("The server-selected sandbox image has no linux/arm64 build."));
    const onPendingReason = vi.fn();
    const executor = await startDesktopLocalExecutor({ ...options, hostConsent: true, downloadConsent: true, onPendingReason });
    await vi.advanceTimersByTimeAsync(11_000);
    state.onRuns?.(["host", "sandbox"].map((mode) => ({ run_id: mode, queue_state: "admitted",
      payload_json: { executionTarget: { kind: "local", deviceId: "device", mode } } })));
    expect(startLocalRun).toHaveBeenCalledOnce();
    expect(startLocalRun).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ run_id: "host" }),
      "", "", expect.anything(), "install");
    expect(onPendingReason).toHaveBeenCalledWith("Host mode ready. Sandbox unavailable: The server-selected sandbox image has no linux/arm64 build.");
    await executor.stop();
  });
  it("runs consented host tasks while Docker is unavailable and fences them on stop", async () => {
    state.ping.mockRejectedValue(new Error("Docker unavailable"));
    const consent = vi.fn();
    const executor = await startDesktopLocalExecutor({ ...options, hostConsent: true, onSandboxDownloadRequired: consent });
    await vi.advanceTimersByTimeAsync(11_000);
    state.onRuns?.([{ run_id: "host-run", queue_state: "admitted", payload_json: { executionTarget: { kind: "local", deviceId: "device", mode: "host" } } }]);
    expect(startLocalRun).toHaveBeenCalledOnce();
    expect(state.pull).not.toHaveBeenCalled();
    expect(consent).not.toHaveBeenCalled();
    await executor.stop();
    expect(state.fence).toHaveBeenCalledOnce();
  });
  it("does not download or start runs when first-use consent is declined", async () => {
    const consent = vi.fn().mockResolvedValue(false);
    const executor = await startDesktopLocalExecutor({...options,onSandboxDownloadRequired:consent});
    await vi.advanceTimersByTimeAsync(5_000);
    expect(consent).toHaveBeenCalledTimes(1);
    state.onRuns?.([{run_id:"r",queue_state:"admitted",payload_json:{executionTarget:{kind:"local",deviceId:"device",mode:"sandbox"}}}]);
    expect(state.pull).not.toHaveBeenCalled(); expect(startLocalRun).not.toHaveBeenCalled();
    await executor.stop();
  });
  it("reconnects, updates pushed digests without stopping active runs, and fences only on stop", async () => {
    const executor = await startDesktopLocalExecutor({...options,apiBaseUrl:"https://server.example.test",downloadConsent:true});
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.pull).toHaveBeenCalledTimes(1);
    expect(state.stream).toHaveBeenCalledTimes(2);
    state.onRuns?.([{run_id:"r",queue_state:"admitted",payload_json:{executionTarget:{kind:"local",deviceId:"device",mode:"sandbox"}}}]);
    expect(startLocalRun).toHaveBeenCalledTimes(1);
    state.digest = "sha256:second";state.present = false;
    state.onEvent?.("config");
    await vi.advanceTimersByTimeAsync(1);
    expect(state.pull).toHaveBeenCalledTimes(2);
    expect(state.request).toHaveBeenCalledWith(expect.any(String),"PATCH",expect.objectContaining({capabilities:expect.objectContaining({sandboxImageDigest:"sha256:second"})}));
    expect(state.fence).not.toHaveBeenCalled();
    await executor.stop(); expect(state.fence).toHaveBeenCalledTimes(1);
  });
  it("does not advertise Docker readiness or accept a run while Docker is stopped", async () => {
    state.ping.mockRejectedValue(new Error("Docker unavailable"));
    const executor = await startDesktopLocalExecutor({...options,downloadConsent:true});
    await vi.advanceTimersByTimeAsync(11_000);
    state.onRuns?.([{run_id:"r",queue_state:"admitted",payload_json:{executionTarget:{kind:"local",deviceId:"device",mode:"sandbox"}}}]);
    expect(startLocalRun).not.toHaveBeenCalled(); expect(state.pull).not.toHaveBeenCalled();
    expect(state.request).toHaveBeenCalledWith(expect.any(String),"PATCH",{capabilities:expect.objectContaining({dockerReady:false,sandboxImageReady:false})});
    await executor.stop();
  });
  it("does no idle config, capability, Docker, or UI work after startup and manually checks safely", async () => {
    const executor = await startDesktopLocalExecutor({ ...options, downloadConsent: true });
    await vi.advanceTimersByTimeAsync(5_000);
    state.onRuns?.([{ run_id: "active", queue_state: "admitted", payload_json: { executionTarget: { kind: "local", deviceId: "device", mode: "sandbox" } } }]);
    const requests = state.request.mock.calls.length;
    const probes = state.ping.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(state.request).toHaveBeenCalledTimes(requests);
    expect(state.ping).toHaveBeenCalledTimes(probes);
    state.onEvent?.("config"); await vi.advanceTimersByTimeAsync(1);
    expect(state.ping).toHaveBeenCalledTimes(probes);
    await executor.checkForUpdates();
    expect(state.ping).toHaveBeenCalledTimes(probes + 1);
    expect(state.fence).not.toHaveBeenCalled();
    expect(state.cleanup).toHaveBeenCalledTimes(1);
    await executor.stop();
  });
  it("reports setup and download failures as errors, with host readiness separate", async () => {
    state.pull.mockRejectedValue(new Error("no linux/arm64 build"));
    const onStatus = vi.fn();
    const executor = await startDesktopLocalExecutor({ ...options, downloadConsent: true, hostConsent: true, onStatus });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({state:"downloading",sandboxReady:false}));
    expect(onStatus).toHaveBeenLastCalledWith(expect.objectContaining({state:"error",hostReady:true,sandboxReady:false}));
    await executor.stop();
  });

  it("acknowledges pushed presence without rechecking Docker or sending full capabilities", async () => {
    const executor=await startDesktopLocalExecutor({...options,downloadConsent:true});
    await vi.advanceTimersByTimeAsync(5_000); const probes=state.ping.mock.calls.length;
    state.request.mockClear();
    await state.onEvent?.("ping",{connectionId:"connection"});
    expect(state.request).toHaveBeenCalledExactlyOnceWith("/api/devices/device/presence","POST",{connectionId:"connection"});
    expect(state.ping).toHaveBeenCalledTimes(probes);
    await executor.stop();
  });

});
