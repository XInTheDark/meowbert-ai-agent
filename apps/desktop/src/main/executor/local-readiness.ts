import fs from "node:fs/promises";
import path from "node:path";
import { RUN_API_PROTOCOL_VERSION } from "@meowbert/shared";
import type { ExecutorSettings } from "@meowbert/run-executor/agent/ports/executor-settings";
import { verifyDeviceWorkspace } from "../workspace-files/roots";
import { verifyMountedStorage } from "../storage/roots";
import { createDesktopDocker, createDockerImageClient, ensureSandboxImage, pinnedImage, sandboxImagePresent } from "../sandbox-image/manager";
import { maintainDownloadedSandboxes } from "../sandbox-image/cleanup";
import { readSandboxHistory, saveSandboxHistory, type SandboxHistory } from "../sandbox-image/history";
import { prepareSandboxSkills, stopDesktopContainers } from "../sandbox-image/resources";
import { probeDesktopSandboxStorage } from "./sandbox-machine-host";
import type { DesktopLocalExecutionStatus } from "../../shared";
import type { DeviceApi } from "./device-api";
import type { DesktopLocalExecutorOptions, LocalExecutionConfig } from "./local-executor";
import type { startLocalRun } from "./local-run";

export class LocalExecutionReadiness {
  ready: { image: string; skillsRoot: string; settings: ExecutorSettings; installId: string } | null = null;
  capabilities: Record<string, unknown>;
  private consent: boolean;
  private downloadDeclined = false;
  private cleaned = false;
  private signature: string | null = null;
  private history: SandboxHistory = { image: null, digest: null, lastCheckedAt: null, lastUpdatedAt: null };
  private historyLoaded = false;
  constructor(private readonly options: DesktopLocalExecutorOptions, private readonly api: DeviceApi,
    private readonly signal: AbortSignal, private readonly runs: Map<string, ReturnType<typeof startLocalRun>>) {
    this.consent = options.downloadConsent;
    this.capabilities = { dockerReady: false, sandboxImageReady: false, executorSupported: true,
      protocolVersion: RUN_API_PROTOCOL_VERSION, hostReady: false };
  }
  report() { return this.api.request("/api/devices/" + this.options.deviceId, "PATCH", { capabilities: this.capabilities }); }
  status(state: DesktopLocalExecutionStatus["state"], message: string | null): void {
    this.options.onStatus?.({ state, message, hostReady: this.capabilities.hostReady === true,
      sandboxReady: this.capabilities.sandboxImageReady === true, sandbox: { ...this.history } });
  }
  async refresh(force = false): Promise<void> {
    if (!this.historyLoaded) { this.history = await readSandboxHistory(this.options.resourcesRoot); this.historyLoaded = true; }
    this.status("checking", "Checking sandbox and storage…");
    const config = await this.api.request<LocalExecutionConfig>("/api/local-execution/config");
    this.signal.throwIfAborted();
    if (!config.enabled) { this.ready = null; throw new Error("Local execution is disabled on this server."); }
    this.history = { ...this.history, lastCheckedAt: new Date().toISOString() };
    await saveSandboxHistory(this.options.resourcesRoot, this.history);
    const signature = JSON.stringify(config);
    if (!force && this.signature === signature && this.ready) { this.status("running", "Ready for local tasks"); return; }
    if (force) this.downloadDeclined = false;
    this.ready = null;
    this.capabilities = { ...this.capabilities, dockerReady: false, sandboxImageReady: false, hostReady: false };
    const { verifiedRoots, installId, storage } = await this.verifyRoots(config);
    this.ready = { image: "", skillsRoot: this.options.hostSkillsRoot ?? "", settings: config.executorSettings, installId };
    this.capabilities.hostReady = this.options.hostConsent === true;
    await this.prepareSandbox(config, verifiedRoots, installId, storage.ok);
    this.signature = signature;
    await this.report(); this.status("running", "Ready for local tasks");
  }
  async failed(error: unknown): Promise<void> {
    this.signature = null;
    this.capabilities.sandboxImageReady = false; this.capabilities.sandboxDownloadInProgress = false;
    const reason = error instanceof Error ? error.message : String(error);
    const message = (this.options.hostConsent && this.ready ? "Host mode ready. Sandbox unavailable: " : "") + reason;
    this.options.onPendingReason?.(message); this.status("error", message);
    await this.report().catch(() => undefined);
  }
  private async verifyRoots(config: LocalExecutionConfig) {
    const verifiedRoots: Record<string, string> = {};
    for (const workspace of config.deviceWorkspaces ?? []) {
      const root = this.options.workspaceRoots?.[workspace.id];
      if (workspace.file_host.deviceId !== this.options.deviceId || !root) continue;
      await verifyDeviceWorkspace(root, workspace.id).then(() => { verifiedRoots["workspace:" + workspace.id] = "verified"; }).catch(() => undefined);
    }
    const installId = config.storageMarkers[this.options.storageBackendId]?.installId ?? "";
    const storage = this.options.storageRoot && installId ? await verifyMountedStorage({ mountPath: this.options.storageRoot,
      backendId: this.options.storageBackendId, deviceId: this.options.deviceId, installId }) : { ok: false };
    if (storage.ok) verifiedRoots[this.options.storageBackendId] = this.options.storageRoot;
    await this.api.request("/api/devices/" + this.options.deviceId, "PATCH", { verifiedRoots });
    if (!Object.keys(verifiedRoots).length) throw new Error("No verified workspace folder is available on this device.");
    return { verifiedRoots, installId, storage };
  }
  private async prepareSandbox(config: LocalExecutionConfig, verifiedRoots: Record<string, string>, installId: string, storageOk: boolean): Promise<void> {
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
      await this.report(); this.status("downloading", "Downloading sandbox update…");
      await ensureSandboxImage({ client, image: config.sandboxImage, onProgress: (message) => this.status("downloading", message) });
      downloaded = true;
    }
    this.signal.throwIfAborted();
    const image = pinnedImage(config.sandboxImage);
    const skillsRoot = await prepareSandboxSkills(image, this.options.resourcesRoot, this.options.deviceId);
    this.signal.throwIfAborted();
    if (this.options.hostBrowserEnabled && this.options.hostSkillsRoot) {
      await fs.cp(path.join(this.options.hostSkillsRoot, "host-browser"), path.join(skillsRoot, "host-browser"), { recursive: true });
    }
    await this.probeRoots(image, skillsRoot, config, verifiedRoots, installId, storageOk);
    await maintainDownloadedSandboxes({ resourcesRoot: this.options.resourcesRoot, currentImage: image, skillsRoot, downloaded,
      inUseImages: [...this.runs.values()].map((run) => run.image) });
    this.history = { ...this.history, image, digest: config.sandboxImage.digest,
      lastUpdatedAt: downloaded ? new Date().toISOString() : this.history.image === image && this.history.digest === config.sandboxImage.digest ? this.history.lastUpdatedAt : null };
    await saveSandboxHistory(this.options.resourcesRoot, this.history);
    this.capabilities = { dockerReady: true, sandboxImageReady: true, sandboxImageDigest: config.sandboxImage.digest,
      executorSupported: true, protocolVersion: RUN_API_PROTOCOL_VERSION, hostReady: this.options.hostConsent === true };
    this.ready = { image, skillsRoot, settings: config.executorSettings, installId };
  }
  private async probeRoots(image: string, skillsRootDir: string, config: LocalExecutionConfig, verifiedRoots: Record<string, string>, installId: string, storageOk: boolean) {
    const probe = (storageRoot: string, backendId: string, id: string) => probeDesktopSandboxStorage({ image,
      deviceId: this.options.deviceId, storageRoot, backendId, installId: id, scratchRoot: this.options.scratchRoot, skillsRootDir });
    try {
      if (storageOk) await probe(this.options.storageRoot, this.options.storageBackendId, installId);
      for (const workspace of config.deviceWorkspaces ?? []) {
        if (verifiedRoots["workspace:" + workspace.id]) await probe(this.options.workspaceRoots![workspace.id], "workspace:" + workspace.id, "");
      }
    } catch (error) {
      this.ready = null; this.capabilities.hostReady = false;
      await this.api.request("/api/devices/" + this.options.deviceId, "PATCH", { verifiedRoots: {} }); throw error;
    }
  }
}
