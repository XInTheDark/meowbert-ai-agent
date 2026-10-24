import type { ExecutorSettings } from "@meowbert/run-executor/agent/ports/executor-settings";
import os from "node:os";
import { RUN_API_PROTOCOL_VERSION, isSupportedLocalExecutor } from "@meowbert/shared";
import type { SandboxImageReference } from "../sandbox-image/manager";
import { createDesktopDocker, createDockerImageClient, ensureSandboxImage, pinnedImage, sandboxImagePresent } from "../sandbox-image/manager";
import { maintainDownloadedSandboxes } from "../sandbox-image/cleanup";
import { prepareSandboxSkills, stopDesktopContainers } from "../sandbox-image/resources";
import { verifyMountedStorage } from "../storage/roots";
import { createDeviceApi, waitForDeviceRetry, type DeviceApiOptions } from "./device-api";
import { probeDesktopSandboxStorage } from "./sandbox-machine-host";
import { startLocalRun, type DeviceRunNotice } from "./local-run";
import { sandboxArchitecture } from "../sandbox-image/platform";

export interface LocalExecutionConfig { enabled: boolean; sandboxImage: SandboxImageReference; executorSettings: ExecutorSettings; storageMarkers: Record<string, { installId: string } | null> }
export interface DesktopLocalExecutorOptions extends DeviceApiOptions {
  maxConcurrentRuns: number; deviceId: string; executorVersion: string; storageBackendId: string; storageRoot: string;
  scratchRoot: string; resourcesRoot: string; downloadConsent: boolean;
  onSandboxDownloadRequired?: (image: SandboxImageReference) => Promise<boolean>;
  onPendingReason?: (reason: string) => void;
}
export async function loadLocalExecutionConfig(options: DeviceApiOptions): Promise<LocalExecutionConfig> {
  return createDeviceApi(options, new AbortController().signal).request("/api/local-execution/config");
}

export async function startDesktopLocalExecutor(options: DesktopLocalExecutorOptions): Promise<{ stop: () => Promise<void> }> {
  sandboxArchitecture();
  if (!isSupportedLocalExecutor(process.platform, process.arch)) throw new Error("Local execution requires Apple Silicon macOS or Windows x64/arm64 with Docker Desktop.");
  const abort = new AbortController();
  const api = createDeviceApi(options, abort.signal);
  const route = "/api/devices/" + options.deviceId;
  const runs = new Map<string, ReturnType<typeof startLocalRun>>();
  let ready: { image: string; skillsRoot: string; settings: ExecutorSettings; installId: string } | null = null;
  let consent = options.downloadConsent;
  let downloadDeclined = false;
  let cleaned = false;
  let capabilities: Record<string, unknown> = { dockerReady: false, sandboxImageReady: false, executorSupported: true, protocolVersion: RUN_API_PROTOCOL_VERSION };
  const report = () => api.request(route, "PATCH", { capabilities });
  const notice = (entries: unknown[]) => {
    if (!ready || abort.signal.aborted) return;
    for (const entry of entries as DeviceRunNotice[]) {
      if (entry.queue_state !== "admitted" || runs.has(entry.run_id)) continue;
      const run = startLocalRun(options, api, entry, ready.image, ready.skillsRoot, ready.settings, ready.installId);
      runs.set(entry.run_id, run);
      void run.done.catch((error) => options.onPendingReason?.(String(error))).finally(() => runs.delete(entry.run_id));
    }
  };
  const heartbeat = async () => {
    while (!abort.signal.aborted) {
      await report().catch(() => undefined);
      await waitForDeviceRetry(abort.signal, 10_000);
    }
  };
  const refresh = async () => {
    ready = null;
    const config = await api.request<LocalExecutionConfig>("/api/local-execution/config");
    if (!config.enabled) throw new Error("Local execution is disabled on this server.");
    capabilities = { ...capabilities, dockerReady: false, sandboxImageReady: false };
    const docker = createDesktopDocker();
    await docker.ping();
    if ((await docker.info()).OSType !== "linux") throw new Error("Switch Docker Desktop to Linux containers for local tasks.");
    capabilities.dockerReady = true;
    if (!cleaned) { await stopDesktopContainers(options.deviceId); cleaned = true; }
    const installId = config.storageMarkers[options.storageBackendId]?.installId;
    if (!installId) throw new Error("The server storage marker is unavailable.");
    const storage = await verifyMountedStorage({ mountPath: options.storageRoot, backendId: options.storageBackendId, deviceId: options.deviceId, installId });
    await api.request(route, "PATCH", { verifiedRoots: storage.ok ? { [options.storageBackendId]: options.storageRoot } : {} });
    if (!storage.ok) throw new Error("The selected storage root is unavailable: " + storage.reason);
    const client = createDockerImageClient();
    let downloaded = false;
    if (!await sandboxImagePresent(client, config.sandboxImage)) {
      if (!consent && !downloadDeclined) {
        consent = await options.onSandboxDownloadRequired?.(config.sandboxImage) === true;
        downloadDeclined = !consent;
      }
      if (!consent) throw new Error("The sandbox download was declined. Enable it in Local Execution settings to retry.");
      capabilities.sandboxDownloadInProgress = true;
      await report();
      await ensureSandboxImage({ client, image: config.sandboxImage, onProgress: options.onPendingReason });
      downloaded = true;
    }
    abort.signal.throwIfAborted();
    const image = pinnedImage(config.sandboxImage);
    const skillsRoot = await prepareSandboxSkills(image, options.resourcesRoot, options.deviceId);
    abort.signal.throwIfAborted();
    try {
      await probeDesktopSandboxStorage({ image, deviceId: options.deviceId, storageRoot: options.storageRoot,
        backendId: options.storageBackendId, installId, scratchRoot: options.scratchRoot, skillsRootDir: skillsRoot });
    } catch (error) {
      await api.request(route, "PATCH", { verifiedRoots: {} });
      throw error;
    }
    await maintainDownloadedSandboxes({ resourcesRoot: options.resourcesRoot, currentImage: image, skillsRoot, downloaded, inUseImages: [...runs.values()].map((run) => run.image) });
    capabilities = { dockerReady: true, sandboxImageReady: true, sandboxImageDigest: config.sandboxImage.digest, executorSupported: true, protocolVersion: RUN_API_PROTOCOL_VERSION };
    ready = { image, skillsRoot, settings: config.executorSettings, installId };
    await report();
    options.onPendingReason?.("Ready for local tasks");
  };
  const setup = async () => {
    while (!abort.signal.aborted) {
      try { await api.request("/api/devices", "POST", { id: options.deviceId, name: os.hostname(), platform: process.platform, architecture: process.arch, executorVersion: options.executorVersion, maxConcurrentRuns: options.maxConcurrentRuns, capabilities }); break; }
      catch (error) { options.onPendingReason?.(String(error)); await waitForDeviceRetry(abort.signal); }
    }
    if (abort.signal.aborted) return;
    const beat = heartbeat();
    const stream = (async () => {
      while (!abort.signal.aborted) {
        await api.stream(route + "/runs/stream", notice).catch(() => undefined);
        await waitForDeviceRetry(abort.signal);
      }
    })();
    try {
      while (!abort.signal.aborted) {
        await refresh().catch((error) => {
          ready = null;
          capabilities.sandboxImageReady = false;
          capabilities.sandboxDownloadInProgress = false;
          options.onPendingReason?.(error instanceof Error ? error.message : String(error));
        });
        await waitForDeviceRetry(abort.signal, 30_000);
      }
    } finally { await Promise.all([beat, stream]); }
  };
  const background = setup().catch((error) => { options.onPendingReason?.(String(error)); abort.abort(); });
  return { stop: async () => {
    abort.abort();
    await Promise.all([...runs.values()].map((run) => run.fence()));
    await stopDesktopContainers(options.deviceId);
    void background;
  } };
}
