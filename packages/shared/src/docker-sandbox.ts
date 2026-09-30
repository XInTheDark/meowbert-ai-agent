import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Duplex, PassThrough, type Readable, type Writable } from "node:stream";
import { promisify } from "node:util";
import Docker, { type Container } from "dockerode";
import { selectSandboxPassthroughEnv, type SandboxConfig, type SandboxResourcesConfig } from "./sandbox.js";
import {
  DEFAULT_EXEC_CLOSE_TIMEOUT_MS,
  FORCE_KILL_DELAY_MS,
  buildKillCommand,
  buildSandboxStateFilePath,
  buildWrappedCommand,
  waitForExecExit,
  withTimeout
} from "./docker-sandbox-process.js";
import {
  normalizeGroupIds,
  resolveSandboxContainerIdentity
} from "./docker-sandbox-identity.js";
import {
  SANDBOX_ENVIRONMENT_ID_LABEL_KEY,
  SANDBOX_LABEL_KEY,
  SANDBOX_PARENT_CONTAINER_ID_LABEL_KEY,
  SANDBOX_PURPOSE_LABEL_KEY,
  SANDBOX_RUN_ID_LABEL_KEY,
  SANDBOX_SESSION_ID_LABEL_KEY,
  SANDBOX_TASK_ID_LABEL_KEY,
  SANDBOX_WORKSPACE_ID_LABEL_KEY,
  buildMissingSandboxImageMessage,
  buildMissingSandboxRuntimeMessage,
  isDockerImageMissingError,
  isDockerRuntimeUnavailableError,
  mapManagedSandboxContainer,
  normalizeSandboxPurpose,
  readDockerRuntimeNames
} from "./docker-sandbox-errors.js";
import {
  buildNestedMountMirrorPath,
  dedupeNestedPaths,
  isContainerPrivateLiveMount,
  listWritableMountRoots,
  mapContainerPathToHostPath,
  readContainerMounts,
  readLiveMountEntries,
  readLiveMountPoints,
  resolveNestedMountMirrorPlan,
  type MountedPathInfo,
  type ResolvedMountSource,
  type ResolvedSandboxMount
} from "./docker-sandbox-mounts.js";
import { readSandboxCrashReport, type SandboxCrashReport } from "./docker-sandbox-crash-report.js";

export {
  formatSandboxCrashReport,
  type SandboxContainerLimits,
  type SandboxCrashReport
} from "./docker-sandbox-crash-report.js";

const CONTAINER_LOOP_COMMAND = ["/bin/sh", "-lc", "trap 'exit 0' TERM INT; while :; do sleep 60; done"];
const execFile = promisify(execFileCallback);

export interface SandboxMountPath {
  path: string;
  readOnly?: boolean;
  optional?: boolean;
}

export interface SandboxContainerLabels {
  workspaceId?: string;
  environmentId?: string;
  taskId?: string;
  runId?: string;
  sessionId?: string;
  purpose: "task-run" | "shell-session" | "shell-exec";
}

export interface SandboxContainerOptions {
  workingDir: string;
  networkEnabled: boolean;
  mounts: SandboxMountPath[];
  ports?: Array<{
    containerPort: number;
    hostIp?: string;
    hostPort?: number;
  }>;
  runAsRoot?: boolean;
  env?: Record<string, string>;
  labels: SandboxContainerLabels;
  resources?: Partial<Pick<SandboxResourcesConfig, "pids" | "memoryMb" | "cpus">>;
  onLifecycleEvent?: (event: {
    stage: string;
    phase: "start" | "success";
    message: string;
    payload?: Record<string, unknown>;
  }) => Promise<void> | void;
}

export interface SandboxAttachedProcess {
  stdin: Writable | null;
  stdout: Readable;
  stderr: Readable | null;
  close: () => Promise<void>;
  waitForExit: () => Promise<number | null>;
}

export interface SandboxExecCommandInput {
  command: string;
  shell: string;
  workingDir: string;
  env?: Record<string, string>;
  timeoutMs: number;
  maxOutputKb: number;
  abortSignal?: AbortSignal;
}

export interface SandboxExecCommandResult {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  aborted: boolean;
  /** Set by crash-recovering wrappers when the container died during the command. */
  sandboxCrash?: string | null;
}

export interface ManagedSandboxContainerSummary {
  containerId: string;
  image: string;
  state: string;
  status: string;
  createdAt: string | null;
  purpose: SandboxContainerLabels["purpose"] | null;
  workspaceId: string | null;
  environmentId: string | null;
  taskId: string | null;
  runId: string | null;
  sessionId: string | null;
  parentContainerId: string | null;
}

interface StartAttachedProcessInput {
  command: string[];
  workingDir: string;
  env?: Record<string, string>;
  tty: boolean;
  trackProcessGroup?: boolean;
  stdin?: boolean;
}

function createDockerClient(dockerHost: string): Docker {
  if (dockerHost.startsWith("unix://")) {
    return new Docker({ socketPath: dockerHost.slice("unix://".length) || "/var/run/docker.sock" });
  }

  const parsed = dockerHost.startsWith("tcp://")
    ? new URL(`http://${dockerHost.slice("tcp://".length)}`)
    : new URL(dockerHost);

  return new Docker({
    protocol: parsed.protocol === "https:" ? "https" : parsed.protocol === "ssh:" ? "ssh" : "http",
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : undefined
  });
}

function detectCurrentContainerId(): string | null {
  const explicit = process.env.MEOWBERT_SANDBOX_PARENT_CONTAINER_ID?.trim();
  if (explicit) {
    return explicit;
  }

  if (!fs.existsSync("/.dockerenv")) {
    return null;
  }

  const hostname = os.hostname().trim();
  if (/^[0-9a-f]{12,64}$/i.test(hostname)) {
    return hostname;
  }

  try {
    const cgroup = fs.readFileSync("/proc/self/cgroup", "utf8");
    const match = cgroup.match(/\b([0-9a-f]{12,64})\b/i);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    // Best-effort detection only.
  }

  return null;
}

function toEnvList(values: Record<string, string> | undefined, config: SandboxConfig): string[] | undefined {
  const passthroughEnv = selectSandboxPassthroughEnv(process.env, config.envPassthroughPatterns);
  const merged = {
    ...passthroughEnv,
    ...(values ?? {})
  };

  const entries = Object.entries(merged)
    .filter(([, value]) => typeof value === "string")
    .map(([key, value]) => `${key}=${value}`);

  return entries.length > 0 ? entries : undefined;
}

async function emitSandboxLifecycleEvent(
  options: SandboxContainerOptions,
  event: {
    stage: string;
    phase: "start" | "success";
    message: string;
    payload?: Record<string, unknown>;
  }
): Promise<void> {
  if (!options.onLifecycleEvent) {
    return;
  }

  try {
    await options.onLifecycleEvent(event);
  } catch (error) {
    console.warn("[sandbox] Failed to emit lifecycle event", error);
  }
}

export const dockerSandboxTestUtils = {
  buildNestedMountMirrorPath,
  buildSandboxStateFilePath,
  buildWrappedCommand,
  buildKillCommand,
  buildMissingSandboxImageMessage,
  buildMissingSandboxRuntimeMessage,
  dedupeNestedPaths,
  isDockerImageMissingError,
  isDockerRuntimeUnavailableError,
  isContainerPrivateLiveMount,
  mapManagedSandboxContainer,
  normalizeSandboxPurpose,
  readLiveMountEntries,
  readLiveMountPoints,
  readDockerRuntimeNames,
  resolveNestedMountMirrorPlan,
  resolveSandboxContainerIdentity,
  waitForExecExit
};

export class DockerSandboxHandle {
  private readonly docker: Docker;
  private readonly config: SandboxConfig;
  private readonly container: Container;
  private readonly baseWorkingDir: string;

  constructor(input: {
    docker: Docker;
    config: SandboxConfig;
    container: Container;
    baseWorkingDir: string;
  }) {
    this.docker = input.docker;
    this.config = input.config;
    this.container = input.container;
    this.baseWorkingDir = input.baseWorkingDir;
  }

  get id(): string {
    return this.container.id;
  }

  async getMappedHostPort(containerPort: number): Promise<number | null> {
    const inspect = await this.container.inspect();
    const bindings = inspect.NetworkSettings?.Ports?.[`${containerPort}/tcp`];
    const hostPort = bindings?.[0]?.HostPort;
    if (!hostPort) {
      return null;
    }

    const parsed = Number.parseInt(hostPort, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  async executeShellCommand(input: SandboxExecCommandInput): Promise<SandboxExecCommandResult> {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    const maxChars = input.maxOutputKb * 1024;

    const attached = await this.startAttachedProcess({
      command: [input.shell, "-lc", input.command],
      workingDir: input.workingDir,
      env: input.env,
      tty: false,
      trackProcessGroup: true,
      stdin: false
    });

    const appendChunk = (current: string, chunk: Buffer): string => {
      const next = `${current}${chunk.toString("utf8")}`;
      return next.length > maxChars ? `${next.slice(0, maxChars)}\n...[truncated]` : next;
    };

    attached.stdout.on("data", (chunk: Buffer) => {
      stdout = appendChunk(stdout, chunk);
    });
    attached.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendChunk(stderr, chunk);
    });

    const timeout = setTimeout(async () => {
      timedOut = true;
      await attached.close();
    }, input.timeoutMs);

    const handleAbortSignal = async (): Promise<void> => {
      aborted = true;
      await attached.close();
    };

    if (input.abortSignal) {
      if (input.abortSignal.aborted) {
        await handleAbortSignal();
      } else {
        input.abortSignal.addEventListener("abort", () => {
          void handleAbortSignal();
        }, { once: true });
      }
    }

    const exitCode = await attached.waitForExit();
    clearTimeout(timeout);

    return {
      command: input.command,
      stdout,
      stderr,
      exitCode: exitCode ?? (timedOut ? 124 : aborted ? 130 : 1),
      timedOut,
      aborted
    };
  }

  async startAttachedProcess(input: StartAttachedProcessInput): Promise<SandboxAttachedProcess> {
    const pidFilePath = input.trackProcessGroup ? buildSandboxStateFilePath() : null;
    const finalCommand = pidFilePath
      ? buildWrappedCommand({ command: input.command, pidFilePath })
      : input.command;

    const exec = await this.container.exec({
      AttachStdin: input.stdin === true,
      AttachStdout: true,
      AttachStderr: true,
      Cmd: finalCommand,
      Env: toEnvList(input.env, this.config),
      Tty: input.tty,
      WorkingDir: input.workingDir
    });

    const rawStream = await exec.start({
      hijack: input.stdin === true,
      stdin: input.stdin === true,
      Tty: input.tty
    }) as Duplex;

    const stdout = input.tty ? rawStream : new PassThrough();
    const stderr = input.tty ? null : new PassThrough();
    if (!input.tty) {
      this.docker.modem.demuxStream(rawStream, stdout as PassThrough, stderr as PassThrough);
    }

    const closePromise = new Promise<void>((resolve) => {
      rawStream.once("close", () => resolve());
      rawStream.once("end", () => resolve());
    });

    const close = async (): Promise<void> => {
      try {
        rawStream.end();
      } catch {
        // Best-effort close only.
      }

      if (!pidFilePath) {
        await Promise.race([
          closePromise,
          new Promise((resolve) => setTimeout(resolve, DEFAULT_EXEC_CLOSE_TIMEOUT_MS).unref())
        ]);
        return;
      }

      await this.startAttachedProcess({
        command: buildKillCommand(pidFilePath, "TERM"),
        workingDir: this.baseWorkingDir,
        tty: false,
        stdin: false
      }).then((process) => process.waitForExit()).catch(() => {});

      const closedGracefully = await Promise.race([
        closePromise.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), FORCE_KILL_DELAY_MS).unref())
      ]);
      if (closedGracefully) {
        return;
      }

      await this.startAttachedProcess({
        command: buildKillCommand(pidFilePath, "KILL"),
        workingDir: this.baseWorkingDir,
        tty: false,
        stdin: false
      }).then((process) => process.waitForExit()).catch(() => {});

      await Promise.race([
        closePromise,
        new Promise((resolve) => setTimeout(resolve, DEFAULT_EXEC_CLOSE_TIMEOUT_MS).unref())
      ]);
    };

    return {
      stdin: input.stdin === true ? rawStream : null,
      stdout: stdout as Readable,
      stderr,
      close,
      waitForExit: async () => waitForExecExit(exec)
    };
  }

  async readCrashReport(): Promise<SandboxCrashReport | null> {
    return withTimeout(
      readSandboxCrashReport(this.docker, this.container.id),
      this.config.startTimeoutMs,
      `Timed out while reading crash report for sandbox container ${this.container.id}`
    );
  }

  async stop(): Promise<void> {
    try {
      await this.container.stop({ t: 1 });
    } catch {
      // Container may already be stopped.
    }
    try {
      await this.container.remove({ force: true });
    } catch {
      // Best-effort cleanup.
    }
  }
}

export class DockerSandboxManager {
  private readonly docker: Docker;
  private readonly config: SandboxConfig;
  private readonly currentContainerId: string | null;
  private currentContainerMounts: MountedPathInfo[] | null = null;
  private readonly nestedMountMirrorPaths = new Map<string, string>();

  constructor(config: SandboxConfig) {
    this.config = config;
    this.docker = createDockerClient(config.dockerHost);
    this.currentContainerId = detectCurrentContainerId();
  }

  getCurrentContainerId(): string | null {
    return this.currentContainerId;
  }

  async assertImageAvailable(): Promise<void> {
    if (this.config.runtime) {
      const info = await withTimeout(
        this.docker.info(),
        this.config.startTimeoutMs,
        "Timed out while inspecting Docker runtimes"
      );
      const availableRuntimes = readDockerRuntimeNames(info);
      if (availableRuntimes.length > 0 && !availableRuntimes.includes(this.config.runtime)) {
        throw new Error(buildMissingSandboxRuntimeMessage(this.config, availableRuntimes));
      }
    }

    try {
      await withTimeout(
        this.docker.getImage(this.config.image).inspect(),
        this.config.startTimeoutMs,
        "Timed out while inspecting sandbox image"
      );
    } catch (error) {
      if (isDockerImageMissingError(error)) {
        throw new Error(buildMissingSandboxImageMessage(this.config));
      }
      throw error;
    }
  }

  async listManagedContainers(): Promise<ManagedSandboxContainerSummary[]> {
    const containers = await withTimeout(
      this.docker.listContainers({ all: true }),
      this.config.startTimeoutMs,
      "Timed out while listing sandbox containers"
    );

    return containers
      .map(mapManagedSandboxContainer)
      .filter((container): container is ManagedSandboxContainerSummary => container !== null);
  }

  async stopAndRemoveContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);

    try {
      await withTimeout(
        container.stop({ t: 1 }),
        this.config.startTimeoutMs,
        `Timed out while stopping sandbox container ${containerId}`
      );
    } catch {
      // Container may already be stopped or missing.
    }

    try {
      await withTimeout(
        container.remove({ force: true }),
        this.config.startTimeoutMs,
        `Timed out while removing sandbox container ${containerId}`
      );
    } catch {
      // Best-effort cleanup.
    }
  }

  async readCrashReport(containerId: string): Promise<SandboxCrashReport | null> {
    return withTimeout(
      readSandboxCrashReport(this.docker, containerId),
      this.config.startTimeoutMs,
      `Timed out while reading crash report for sandbox container ${containerId}`
    );
  }

  async attachPersistentSandbox(input: {
    containerId: string;
    workingDir: string;
  }): Promise<DockerSandboxHandle> {
    const container = this.docker.getContainer(input.containerId);
    const inspect = await withTimeout(
      container.inspect(),
      this.config.startTimeoutMs,
      `Timed out while inspecting sandbox container ${input.containerId}`
    );
    if (!inspect.State?.Running) {
      throw new Error(`Persistent sandbox container is not running: ${input.containerId}`);
    }

    return new DockerSandboxHandle({
      docker: this.docker,
      config: this.config,
      container,
      baseWorkingDir: input.workingDir
    });
  }

  private async ensureCurrentContainerMounts(): Promise<MountedPathInfo[] | null> {
    if (!this.currentContainerId) {
      return null;
    }
    if (this.currentContainerMounts) {
      return this.currentContainerMounts;
    }

    const container = this.docker.getContainer(this.currentContainerId);
    const inspect = await container.inspect();
    this.currentContainerMounts = readContainerMounts(inspect);
    return this.currentContainerMounts;
  }

  private async resolveNestedMountMirrorPath(
    mounts: MountedPathInfo[],
    containerPath: string
  ): Promise<string | null> {
    const liveMounts = readLiveMountEntries(await fs.promises.readFile("/proc/self/mountinfo", "utf8"));
    const mirrorPlan = resolveNestedMountMirrorPlan({
      containerPath,
      staticMountDestinations: mounts.map((mount) => mount.destination),
      liveMounts
    });
    if (!mirrorPlan) {
      return null;
    }

    const cachedMirrorRoot = this.nestedMountMirrorPaths.get(mirrorPlan.liveMountPoint);
    const mirrorRoot = cachedMirrorRoot
      ?? buildNestedMountMirrorPath(
        mirrorPlan.staticMountDestination,
        mirrorPlan.liveMountPoint,
        this.currentContainerId
      );
    await fs.promises.mkdir(mirrorRoot, { recursive: true });

    const ensureMirrorMounted = async (): Promise<boolean> => {
      try {
        await execFile("mountpoint", ["-q", mirrorRoot]);
        return true;
      } catch {
        return false;
      }
    };

    if (!(await ensureMirrorMounted())) {
      try {
        await execFile("mount", ["--rbind", mirrorPlan.liveMountPoint, mirrorRoot]);
      } catch (error) {
        if (!(await ensureMirrorMounted())) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Failed to create sandbox mount mirror for ${mirrorPlan.liveMountPoint} at ${mirrorRoot}: ${message}`
          );
        }
      }
    }

    this.nestedMountMirrorPaths.set(mirrorPlan.liveMountPoint, mirrorRoot);
    return mirrorPlan.relativePath.length > 0
      ? path.resolve(mirrorRoot, mirrorPlan.relativePath)
      : mirrorRoot;
  }

  private async resolveMountSource(containerPath: string, optional: boolean): Promise<ResolvedMountSource | null> {
    const mounts = await this.ensureCurrentContainerMounts();
    if (!mounts) {
      return {
        source: path.resolve(containerPath),
        sourceKind: "direct"
      };
    }

    // Mounted backends are expected to live on the Docker host under the same
    // runtime tree that is bind-mounted into this container (for example
    // /srv/meowbert/runtime -> /app/runtime). Prefer that direct host path so
    // sibling sandboxes see the real host-mounted backend instead of an
    // in-container mirror directory.
    const directMappedPath = mapContainerPathToHostPath(mounts, containerPath);
    if (directMappedPath) {
      return {
        source: directMappedPath,
        sourceKind: "direct"
      };
    }

    const mirroredContainerPath = await this.resolveNestedMountMirrorPath(mounts, containerPath);
    const mappedPath = mapContainerPathToHostPath(mounts, mirroredContainerPath ?? containerPath);
    if (!mappedPath && optional) {
      return null;
    }
    if (!mappedPath) {
      throw new Error(`Unable to map sandbox path to a Docker host path: ${containerPath}`);
    }

    return {
      source: mappedPath,
      sourceKind: mirroredContainerPath ? "mirror" : "direct"
    };
  }

  private async resolveSandboxMounts(mounts: SandboxMountPath[]): Promise<ResolvedSandboxMount[]> {
    const resolvedMounts: ResolvedSandboxMount[] = [];

    for (const mount of mounts) {
      const source = await this.resolveMountSource(mount.path, mount.optional === true);
      if (!source) {
        continue;
      }

      resolvedMounts.push({
        source: source.source,
        sourceKind: source.sourceKind,
        destination: path.resolve(mount.path),
        accessiblePath: path.resolve(mount.path),
        readOnly: mount.readOnly === true
      });
    }

    return resolvedMounts;
  }

  private createBindList(mounts: ResolvedSandboxMount[]): string[] {
    return mounts.map((mount) => `${mount.source}:${mount.destination}:${mount.readOnly ? "ro" : "rw"}`);
  }

  private async resolveWritableMountGids(mounts: ResolvedSandboxMount[]): Promise<number[]> {
    const writableSources = listWritableMountRoots(mounts);

    const stats = await Promise.all(writableSources.map(async (source) => fs.promises.stat(source)));
    return normalizeGroupIds(stats.map((stat) => stat.gid));
  }

  private async normalizeWritableMountSources(mounts: ResolvedSandboxMount[]): Promise<void> {
    const writableSources = listWritableMountRoots(mounts);

    await Promise.all(writableSources.map(async (source) => {
      try {
        await execFile("chmod", ["u+rwX,g+rwX", source]);
        const stats = await fs.promises.stat(source);
        if (stats.isDirectory()) {
          await execFile("chmod", ["g+s", source]);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to normalize sandbox write permissions for ${source}: ${message}`);
      }
    }));
  }

  async createPersistentSandbox(options: SandboxContainerOptions): Promise<DockerSandboxHandle> {
    await emitSandboxLifecycleEvent(options, {
      stage: "sandbox.mounts",
      phase: "start",
      message: "Resolving sandbox mounts.",
      payload: {
        requestedMountCount: options.mounts.length
      }
    });
    const resolvedMounts = await this.resolveSandboxMounts(options.mounts);
    await emitSandboxLifecycleEvent(options, {
      stage: "sandbox.mounts",
      phase: "success",
      message: "Resolved sandbox mounts.",
      payload: {
        resolvedMountCount: resolvedMounts.length,
        writableMountCount: resolvedMounts.filter((mount) => !mount.readOnly).length,
        mounts: resolvedMounts.map((mount) => ({
          source: mount.source,
          sourceKind: mount.sourceKind,
          destination: mount.destination,
          accessiblePath: mount.accessiblePath,
          readOnly: mount.readOnly
        }))
      }
    });
    await emitSandboxLifecycleEvent(options, {
      stage: "sandbox.identity",
      phase: "start",
      message: "Resolving sandbox execution identity."
    });
    const writableMountGids = await this.resolveWritableMountGids(resolvedMounts);
    const sandboxIdentity = resolveSandboxContainerIdentity({
      runAsRoot: options.runAsRoot,
      processUid: typeof process.getuid === "function" ? process.getuid() : null,
      processGid: typeof process.getgid === "function" ? process.getgid() : null,
      writableMountGids
    });
    await emitSandboxLifecycleEvent(options, {
      stage: "sandbox.identity",
      phase: "success",
      message: "Resolved sandbox execution identity.",
      payload: {
        runAsRoot: options.runAsRoot === true,
        writableMountGroupCount: writableMountGids.length,
        requiresWritableMountNormalization: sandboxIdentity.requiresWritableMountNormalization
      }
    });

    if (sandboxIdentity.requiresWritableMountNormalization) {
      await emitSandboxLifecycleEvent(options, {
        stage: "sandbox.permissions",
        phase: "start",
        message: "Preparing writable sandbox mounts without recursion.",
        payload: {
          writableMountCount: resolvedMounts.filter((mount) => !mount.readOnly).length,
          recursive: false
        }
      });
      await this.normalizeWritableMountSources(resolvedMounts);
      await emitSandboxLifecycleEvent(options, {
        stage: "sandbox.permissions",
        phase: "success",
        message: "Prepared writable sandbox mounts without recursion.",
        payload: {
          writableMountCount: resolvedMounts.filter((mount) => !mount.readOnly).length,
          recursive: false
        }
      });
    }

    const binds = this.createBindList(resolvedMounts);
    const resources = {
      pids: options.resources?.pids ?? this.config.resources.pids,
      memoryMb: options.resources?.memoryMb ?? this.config.resources.memoryMb,
      cpus: options.resources?.cpus ?? this.config.resources.cpus
    };
    const hostConfig: Docker.ContainerCreateOptions["HostConfig"] = {
      AutoRemove: false,
      Binds: binds,
      NetworkMode: options.networkEnabled ? undefined : "none",
      PidsLimit: resources.pids,
      ReadonlyRootfs: true,
      SecurityOpt: ["no-new-privileges:true"],
      CapDrop: ["ALL"],
      ...(sandboxIdentity.groupAdd ? { GroupAdd: sandboxIdentity.groupAdd } : {}),
      Tmpfs: {
        "/tmp": "rw,exec,nosuid"
      }
    };
    const requestedPorts = (options.ports ?? [])
      .filter((port) => Number.isInteger(port.containerPort) && port.containerPort > 0 && port.containerPort <= 65535);
    const exposedPorts: Docker.ContainerCreateOptions["ExposedPorts"] = {};
    if (requestedPorts.length > 0) {
      hostConfig.PortBindings = {};
      for (const port of requestedPorts) {
        const key = `${port.containerPort}/tcp`;
        exposedPorts[key] = {};
        hostConfig.PortBindings[key] = [{
          HostIp: port.hostIp ?? "127.0.0.1",
          HostPort: port.hostPort ? String(port.hostPort) : ""
        }];
      }
    }
    if (this.config.runtime) {
      hostConfig.Runtime = this.config.runtime;
    }

    if (typeof resources.memoryMb === "number") {
      hostConfig.Memory = resources.memoryMb * 1024 * 1024;
    }
    if (typeof resources.cpus === "number") {
      hostConfig.NanoCpus = Math.max(1, Math.floor(resources.cpus * 1_000_000_000));
    }

    const labels: Record<string, string> = {
      [SANDBOX_LABEL_KEY]: "true",
      [SANDBOX_PURPOSE_LABEL_KEY]: options.labels.purpose
    };
    if (options.labels.workspaceId) {
      labels[SANDBOX_WORKSPACE_ID_LABEL_KEY] = options.labels.workspaceId;
    }
    if (options.labels.environmentId) {
      labels[SANDBOX_ENVIRONMENT_ID_LABEL_KEY] = options.labels.environmentId;
    }
    if (options.labels.taskId) {
      labels[SANDBOX_TASK_ID_LABEL_KEY] = options.labels.taskId;
    }
    if (options.labels.runId) {
      labels[SANDBOX_RUN_ID_LABEL_KEY] = options.labels.runId;
    }
    if (options.labels.sessionId) {
      labels[SANDBOX_SESSION_ID_LABEL_KEY] = options.labels.sessionId;
    }
    if (this.currentContainerId) {
      labels[SANDBOX_PARENT_CONTAINER_ID_LABEL_KEY] = this.currentContainerId;
    }

    let container: Container;
    await emitSandboxLifecycleEvent(options, {
      stage: "sandbox.container_create",
      phase: "start",
      message: "Creating sandbox container.",
      payload: {
        bindCount: binds.length
      }
    });
    try {
      container = await withTimeout(
        this.docker.createContainer({
          Image: this.config.image,
          Entrypoint: CONTAINER_LOOP_COMMAND.slice(0, 2),
          Cmd: CONTAINER_LOOP_COMMAND.slice(2),
          WorkingDir: options.workingDir,
          Env: toEnvList(options.env, this.config),
          ...(requestedPorts.length > 0 ? { ExposedPorts: exposedPorts } : {}),
          User: sandboxIdentity.user,
          Labels: labels,
          HostConfig: hostConfig
        }),
        this.config.startTimeoutMs,
        "Timed out while creating sandbox container"
      );
    } catch (error) {
      if (isDockerImageMissingError(error)) {
        throw new Error(buildMissingSandboxImageMessage(this.config));
      }
      if (isDockerRuntimeUnavailableError(error)) {
        throw new Error(buildMissingSandboxRuntimeMessage(this.config));
      }
      throw error;
    }
    await emitSandboxLifecycleEvent(options, {
      stage: "sandbox.container_create",
      phase: "success",
      message: "Created sandbox container.",
      payload: {
        bindCount: binds.length
      }
    });

    await emitSandboxLifecycleEvent(options, {
      stage: "sandbox.container_start",
      phase: "start",
      message: "Starting sandbox container."
    });
    await withTimeout(
      container.start(),
      this.config.startTimeoutMs,
      "Timed out while starting sandbox container"
    );
    await emitSandboxLifecycleEvent(options, {
      stage: "sandbox.container_start",
      phase: "success",
      message: "Started sandbox container."
    });

    return new DockerSandboxHandle({
      docker: this.docker,
      config: this.config,
      container,
      baseWorkingDir: options.workingDir
    });
  }

  async runEphemeralShellCommand(input: {
    workingDir: string;
    networkEnabled: boolean;
    mounts: SandboxMountPath[];
    runAsRoot?: boolean;
    labels: SandboxContainerLabels;
    shell: string;
    command: string;
    env?: Record<string, string>;
    timeoutMs: number;
    maxOutputKb: number;
  }): Promise<SandboxExecCommandResult> {
    const sandbox = await this.createPersistentSandbox({
      workingDir: input.workingDir,
      networkEnabled: input.networkEnabled,
      mounts: input.mounts,
      runAsRoot: input.runAsRoot,
      env: input.env,
      labels: input.labels
    });

    try {
      return await sandbox.executeShellCommand({
        shell: input.shell,
        command: input.command,
        workingDir: input.workingDir,
        env: input.env,
        timeoutMs: input.timeoutMs,
        maxOutputKb: input.maxOutputKb
      });
    } finally {
      await sandbox.stop();
    }
  }
}
