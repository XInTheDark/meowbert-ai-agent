import fsPromises from "node:fs/promises";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import {
  findStorageBackendById,
  resolveEnvironmentStorageRootForBackend,
  resolveWorkspaceStorageRootForBackend,
  type NormalizedStorageConfig,
  type MountedStorageBackendConfig,
  type StorageBackendConfig
} from "./storage-backends.js";

const execFile = promisify(execFileCallback);
const MOUNTPOINT_COMMAND = "mountpoint";
const MOUNTPOINT_TIMEOUT_MS = 5_000;

export interface StorageBackendHealth {
  backendId: string;
  mounted: boolean;
  state: "ready" | "error";
  message: string | null;
}

export interface StorageBackendRuntimeLogger {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

export interface StorageBackendCommandRunner {
  execFile(
    command: string,
    args: string[],
    options?: { timeoutMs?: number }
  ): Promise<{ stdout: string; stderr: string }>;
}

interface StorageBackendRuntimeRegistryOptions {
  logger?: StorageBackendRuntimeLogger;
  commandRunner?: StorageBackendCommandRunner;
}

function defaultLogger(): StorageBackendRuntimeLogger {
  return {
    info: (message) => console.info(message),
    warn: (message) => console.warn(message),
    error: (message) => console.error(message)
  };
}

function defaultCommandRunner(): StorageBackendCommandRunner {
  return {
    async execFile(
      command: string,
      args: string[],
      options?: { timeoutMs?: number }
    ): Promise<{ stdout: string; stderr: string }> {
      const result = await execFile(command, args, {
        encoding: "utf8",
        timeout: options?.timeoutMs
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr
      };
    }
  };
}

function formatCommandFailureMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const stderrValue = "stderr" in error ? error.stderr : null;
  const stderr =
    typeof stderrValue === "string"
      ? stderrValue.trim()
      : Buffer.isBuffer(stderrValue)
        ? stderrValue.toString("utf8").trim()
        : "";

  if (!stderr || error.message.includes(stderr)) {
    return error.message;
  }

  return `${error.message}\n${stderr}`;
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolveFn: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });

  return {
    promise,
    resolve: () => {
      resolveFn?.();
    }
  };
}

async function ensureDirectory(absolutePath: string): Promise<void> {
  await fsPromises.mkdir(absolutePath, { recursive: true });
}

async function readDirectoryEntryCount(absolutePath: string): Promise<number> {
  const entries = await fsPromises.readdir(absolutePath).catch(() => []);
  return entries.length;
}

async function isMounted(mountPath: string, runner: StorageBackendCommandRunner): Promise<boolean> {
  try {
    await runner.execFile(MOUNTPOINT_COMMAND, ["-q", mountPath], {
      timeoutMs: MOUNTPOINT_TIMEOUT_MS
    });
    return true;
  } catch {
    return false;
  }
}

function formatInactiveMountMessage(mountPath: string): string {
  return [
    `Mounted storage backend path is not an active mountpoint inside the API/worker container: ${mountPath}.`,
    "If the host path is already mounted, check that this container path maps to that host path and that the runtime bind mount uses shared propagation."
  ].join(" ");
}

async function ensureMountedBackendPathExists(backend: MountedStorageBackendConfig): Promise<void> {
  let stat;
  try {
    stat = await fsPromises.stat(backend.mountPath);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new Error(`Mounted storage backend path does not exist: ${backend.mountPath}`);
    }
    throw error;
  }

  if (!stat.isDirectory()) {
    throw new Error(`Mounted storage backend path is not a directory: ${backend.mountPath}`);
  }
}

async function ensureMountedBackendReady(
  backend: MountedStorageBackendConfig,
  runner: StorageBackendCommandRunner
): Promise<void> {
  await ensureMountedBackendPathExists(backend);
  if (!(await isMounted(backend.mountPath, runner))) {
    throw new Error(formatInactiveMountMessage(backend.mountPath));
  }
}

export class StorageBackendRuntimeRegistry {
  private readonly storage: NormalizedStorageConfig;
  private readonly logger: StorageBackendRuntimeLogger;
  private readonly commandRunner: StorageBackendCommandRunner;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(storage: NormalizedStorageConfig, options: StorageBackendRuntimeRegistryOptions = {}) {
    this.storage = storage;
    this.logger = options.logger ?? defaultLogger();
    this.commandRunner = options.commandRunner ?? defaultCommandRunner();
  }

  listBackends(): StorageBackendConfig[] {
    return [...this.storage.backends];
  }

  getConfiguredDefaultBackendId(): string {
    return this.storage.defaultWorkspaceBackendId;
  }

  getBackend(backendId: string): StorageBackendConfig {
    const backend = findStorageBackendById(this.storage, backendId);
    if (!backend) {
      throw new Error(`Storage backend not configured: ${backendId}`);
    }
    return backend;
  }

  resolveManagedWorkspaceRoot(backendId: string, workspaceId: string): string {
    return resolveWorkspaceStorageRootForBackend(this.getBackend(backendId), workspaceId);
  }

  resolveManagedEnvironmentRoot(backendId: string, workspaceId: string, environmentId: string): string {
    return resolveEnvironmentStorageRootForBackend(this.getBackend(backendId), workspaceId, environmentId);
  }

  async ensureBackendReady(backendId: string): Promise<void> {
    await this.withBackendLock(backendId, async () => {
      const backend = this.getBackend(backendId);
      if (backend.type === "local") {
        await Promise.all([
          ensureDirectory(backend.workspacesRoot),
          ensureDirectory(backend.environmentsRoot)
        ]);
        return;
      }

      await ensureMountedBackendReady(backend, this.commandRunner);
      const workspaceBase = path.resolve(backend.mountPath, backend.workspacesDir ?? "workspaces");
      await ensureDirectory(workspaceBase);
    });
  }

  async getBackendHealth(backendId: string, input?: { ensureMounted?: boolean }): Promise<StorageBackendHealth> {
    const ensureMountedFirst = input?.ensureMounted === true;

    try {
      if (ensureMountedFirst) {
        await this.ensureBackendReady(backendId);
      }

      const backend = this.getBackend(backendId);
      if (backend.type === "local") {
        await Promise.all([
          ensureDirectory(backend.workspacesRoot),
          ensureDirectory(backend.environmentsRoot)
        ]);
        return {
          backendId,
          mounted: true,
          state: "ready",
          message: null
        };
      }

      await ensureMountedBackendPathExists(backend);
      const mounted = await isMounted(backend.mountPath, this.commandRunner);
      return {
        backendId,
        mounted,
        state: mounted ? "ready" : "error",
        message: mounted ? null : formatInactiveMountMessage(backend.mountPath)
      };
    } catch (error) {
      this.logger.warn?.(`[storage] Backend health check failed for ${backendId}: ${formatCommandFailureMessage(error)}`);
      return {
        backendId,
        mounted: false,
        state: "error",
        message: formatCommandFailureMessage(error)
      };
    }
  }

  private async withBackendLock(backendId: string, work: () => Promise<void>): Promise<void> {
    const previous = this.locks.get(backendId) ?? Promise.resolve();
    const deferred = createDeferred();
    const current = previous.then(() => deferred.promise).catch(() => deferred.promise);
    this.locks.set(backendId, current);

    await previous.catch(() => {});
    try {
      await work();
    } finally {
      deferred.resolve();
      if (this.locks.get(backendId) === current) {
        this.locks.delete(backendId);
      }
    }
  }
}

export async function isStoragePathEmpty(absolutePath: string): Promise<boolean> {
  await ensureDirectory(absolutePath);
  return (await readDirectoryEntryCount(absolutePath)) === 0;
}
