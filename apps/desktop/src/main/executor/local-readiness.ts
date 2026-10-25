import fs from "node:fs/promises";
import path from "node:path";
import { RUN_API_PROTOCOL_VERSION } from "@meowbert/shared";
import type { ExecutorSettings } from "@meowbert/run-executor/agent/ports/executor-settings";
import { applyDeviceTombstones } from "../workspace-files/tombstones";
import { verifyDeviceWorkspace } from "../workspace-files/roots";
import { verifyMountedStorage } from "../storage/roots";
import { createDesktopDocker, createDockerImageClient, ensureSandboxImage, pinnedImage, sandboxImagePresent } from "../sandbox-image/manager";
import { maintainDownloadedSandboxes } from "../sandbox-image/cleanup";
import { prepareSandboxSkills, stopDesktopContainers } from "../sandbox-image/resources";
import { probeDesktopSandboxStorage } from "./sandbox-machine-host";
import type { DeviceApi } from "./device-api";
import type { DesktopLocalExecutorOptions, LocalExecutionConfig } from "./local-executor";
import type { startLocalRun } from "./local-run";

export class LocalExecutionReadiness {
  ready: { image: string; skillsRoot: string; settings: ExecutorSettings; installId: string } | null = null;
  capabilities: Record<string, unknown>;
  private consent: boolean;
  private downloadDeclined = false;
  private cleaned = false;
  constructor(private readonly options: DesktopLocalExecutorOptions, private readonly api: DeviceApi,
    private readonly signal: AbortSignal, private readonly runs: Map<string, ReturnType<typeof startLocalRun>>) {
    this.consent = options.downloadConsent;
    this.capabilities = { dockerReady: false, sandboxImageReady: false, executorSupported: true,
      protocolVersion: RUN_API_PROTOCOL_VERSION, hostReady: options.hostConsent === true };
  }
  report() { return this.api.request("/api/devices/" + this.options.deviceId, "PATCH", { capabilities: this.capabilities }); }
  async refresh(): Promise<void> {
    this.ready = null;
    await applyDeviceTombstones({ api: this.api, deviceId: this.options.deviceId, scratchRoot: this.options.scratchRoot,
      workspaceRoots: this.options.workspaceRoots ?? {}, activeWorkspaceIds: new Set([...this.runs.values()].map((run) => run.workspaceId)) });
    const config = await this.api.request<LocalExecutionConfig>("/api/local-execution/config");
    if (!config.enabled) throw new Error("Local execution is disabled on this server.");
    this.capabilities = { ...this.capabilities, dockerReady: false, sandboxImageReady: false };
    const verifiedRoots: Record<string, string> = {};
    for (const workspace of config.deviceWorkspaces ?? []) {
      const root = this.options.workspaceRoots?.[workspace.id];
      if (workspace.file_host.deviceId !== this.options.deviceId || !root) continue;
      await verifyDeviceWorkspace(root, workspace.id).then(() => { verifiedRoots["workspace:" + workspace.id] = "verified"; }).catch(() => undefined);
    }
    const installId = config.storageMarkers[this.options.storageBackendId]?.installId ?? "";
    const storage = this.options.storageRoot && installId ? await verifyMountedStorage({ mountPath: this.options.storageRoot, backendId: this.options.storageBackendId, deviceId: this.options.deviceId, installId }) : { ok: false };
    if (storage.ok) verifiedRoots[this.options.storageBackendId] = this.options.storageRoot;
    await this.api.request("/api/devices/" + this.options.deviceId, "PATCH", { verifiedRoots });
    if (Object.keys(verifiedRoots).length === 0) throw new Error("No verified workspace folder is available on this device.");
    this.ready = { image: "", skillsRoot: this.options.hostSkillsRoot ?? "", settings: config.executorSettings, installId };
    const docker = createDesktopDocker();
    try { await docker.ping(); }
    catch (error) {
      if (!this.options.hostConsent && !this.downloadDeclined) {
        this.downloadDeclined = true;
        await this.options.onSandboxDownloadRequired?.(config.sandboxImage, "Docker Desktop is not installed or running. Start Docker Desktop, or use host mode instead.");
      }
      throw error;
    }
    if ((await docker.info()).OSType !== "linux") throw new Error("Switch Docker Desktop to Linux containers for local tasks.");
    this.capabilities.dockerReady = true;
    if (!this.cleaned) { await stopDesktopContainers(this.options.deviceId); this.cleaned = true; }
    const client = createDockerImageClient();
    let downloaded = false;
    if (!await sandboxImagePresent(client, config.sandboxImage)) {
      if (!this.consent && !this.downloadDeclined) {
        this.consent = await this.options.onSandboxDownloadRequired?.(config.sandboxImage) === true;
        this.downloadDeclined = !this.consent;
      }
      if (!this.consent) throw new Error("The sandbox download was declined. Enable it in Local Execution settings to retry.");
      this.capabilities.sandboxDownloadInProgress = true;
      await this.report();
      await ensureSandboxImage({ client, image: config.sandboxImage, onProgress: this.options.onPendingReason });
      downloaded = true;
    }
    this.signal.throwIfAborted();
    const image = pinnedImage(config.sandboxImage);
    const skillsRoot = await prepareSandboxSkills(image, this.options.resourcesRoot, this.options.deviceId);
    this.signal.throwIfAborted();
    if (this.options.hostBrowserEnabled && this.options.hostSkillsRoot) {
      await fs.cp(path.join(this.options.hostSkillsRoot, "host-browser"), path.join(skillsRoot, "host-browser"), { recursive: true });
    }
    try {
      if (storage.ok) await probeDesktopSandboxStorage({ image, deviceId: this.options.deviceId, storageRoot: this.options.storageRoot,
        backendId: this.options.storageBackendId, installId, scratchRoot: this.options.scratchRoot, skillsRootDir: skillsRoot });
      for (const workspace of config.deviceWorkspaces ?? []) {
        if (!verifiedRoots["workspace:" + workspace.id]) continue;
        await probeDesktopSandboxStorage({ image, deviceId: this.options.deviceId, storageRoot: this.options.workspaceRoots![workspace.id],
          backendId: "workspace:" + workspace.id, installId: "", scratchRoot: this.options.scratchRoot, skillsRootDir: skillsRoot });
      }
    } catch (error) {
      await this.api.request("/api/devices/" + this.options.deviceId, "PATCH", { verifiedRoots: {} });
      throw error;
    }
    await maintainDownloadedSandboxes({ resourcesRoot: this.options.resourcesRoot, currentImage: image, skillsRoot, downloaded, inUseImages: [...this.runs.values()].map((run) => run.image) });
    this.capabilities = { dockerReady: true, sandboxImageReady: true, sandboxImageDigest: config.sandboxImage.digest, executorSupported: true, protocolVersion: RUN_API_PROTOCOL_VERSION, hostReady: this.options.hostConsent === true };
    this.ready = { image, skillsRoot, settings: config.executorSettings, installId };
    await this.report();
    this.options.onPendingReason?.("Ready for local tasks");
  }
}
