import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  digest: "sha256:first", present: false, onRuns: null as null | ((runs: unknown[]) => void), request: vi.fn(),
  stream: vi.fn(), pull: vi.fn(), fence: vi.fn(), cleanup: vi.fn(), ping: vi.fn()
}));
vi.mock("../sandbox-image/manager", () => ({
  createDesktopDocker: () => ({ ping: state.ping, info: async () => ({ OSType: "linux" }) }), createDockerImageClient: () => ({}),
  pinnedImage: (image: { digest: string }) => "registry/image@" + image.digest,
  sandboxImagePresent: async () => state.present,
  ensureSandboxImage: state.pull
}));
vi.mock("../sandbox-image/cleanup", () => ({maintainDownloadedSandboxes:async()=>{}}));
vi.mock("../sandbox-image/resources", () => ({ prepareSandboxSkills: async () => "/skills", stopDesktopContainers: state.cleanup }));
vi.mock("./sandbox-machine-host", () => ({probeDesktopSandboxStorage:async()=>{}}));
vi.mock("../storage/roots", () => ({verifyMountedStorage:async () => ({ok:true})}));
vi.mock("./local-run", () => ({ startLocalRun: vi.fn(() => ({done:new Promise(() => {}),fence:state.fence})) }));
vi.mock("./device-api", async () => {
  const actual = await vi.importActual<typeof import("./device-api")>("./device-api");
  return { ...actual, createDeviceApi: (_options: unknown, signal: AbortSignal) => ({ request:state.request,
    stream: async (_route:string, onRuns:(runs:unknown[])=>void) => {
      state.stream(); state.onRuns = onRuns;
      if (state.stream.mock.calls.length === 1) throw new Error("connection lost");
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
  state.request.mockImplementation(async (route:string) => route.endsWith("/config") ? {enabled:true,storageMarkers:{backend:{installId:"install"}},sandboxImage:{reference:"registry/image:main",digest:state.digest},executorSettings:{}} : {});
});
afterEach(() => vi.useRealTimers());
describe.skipIf(process.platform !== "darwin" || process.arch !== "arm64")("desktop supervisor", () => {
  it("does not download or start runs when first-use consent is declined", async () => {
    const consent = vi.fn().mockResolvedValue(false);
    const executor = await startDesktopLocalExecutor({...options,onSandboxDownloadRequired:consent});
    await vi.waitFor(() => expect(consent).toHaveBeenCalledTimes(1));
    state.onRuns?.([{run_id:"r",queue_state:"admitted",payload_json:{}}]);
    expect(state.pull).not.toHaveBeenCalled(); expect(startLocalRun).not.toHaveBeenCalled();
    await executor.stop();
  });
  it("reconnects the stream updates digests and fences active runs on stop", async () => {
    const executor = await startDesktopLocalExecutor({...options,apiBaseUrl:"https://server.example.test",downloadConsent:true});
    await vi.waitFor(() => expect(state.pull).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state.stream).toHaveBeenCalledTimes(2);
    state.onRuns?.([{run_id:"r",queue_state:"admitted",payload_json:{}}]);
    expect(startLocalRun).toHaveBeenCalledTimes(1);
    state.digest = "sha256:second";state.present = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state.pull).toHaveBeenCalledTimes(2);
    expect(state.request).toHaveBeenCalledWith(expect.any(String),"PATCH",expect.objectContaining({capabilities:expect.objectContaining({sandboxImageDigest:"sha256:second"})}));
    await executor.stop(); expect(state.fence).toHaveBeenCalledTimes(1);
  });
  it("does not advertise Docker readiness or accept a run while Docker is stopped", async () => {
    state.ping.mockRejectedValue(new Error("Docker unavailable"));
    const executor = await startDesktopLocalExecutor({...options,downloadConsent:true});
    await vi.advanceTimersByTimeAsync(11_000);
    state.onRuns?.([{run_id:"r",queue_state:"admitted",payload_json:{}}]);
    expect(startLocalRun).not.toHaveBeenCalled(); expect(state.pull).not.toHaveBeenCalled();
    expect(state.request).toHaveBeenCalledWith(expect.any(String),"PATCH",{capabilities:expect.objectContaining({dockerReady:false,sandboxImageReady:false})});
    await executor.stop();
  });
});
