import type { StorageBackendConfig } from "./storage-backends.js";
import type { StorageBackendRuntimeRegistry, StorageBackendRuntimeLogger } from "./storage-backend-runtime.js";

const DEFAULT_STARTUP_WARMUP_TIMEOUT_MS = 95_000;

function formatStartupWarmupError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const guardedPromise = promise.catch((error) => {
    throw error;
  });

  try {
    return await Promise.race([
      guardedPromise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    void guardedPromise.catch(() => undefined);
  }
}

export async function warmStorageBackendsOnStartup(
  registry: Pick<StorageBackendRuntimeRegistry, "listBackends" | "ensureBackendReady">,
  input: {
    backendTypes?: StorageBackendConfig["type"][];
    timeoutMs?: number;
    logger?: StorageBackendRuntimeLogger;
  } = {}
): Promise<void> {
  const backendTypes = new Set(input.backendTypes ?? ["mounted"]);
  const timeoutMs = Math.max(1_000, Math.floor(input.timeoutMs ?? DEFAULT_STARTUP_WARMUP_TIMEOUT_MS));
  const logger = input.logger;
  const backends = registry.listBackends().filter((backend) => backendTypes.has(backend.type));

  for (const backend of backends) {
    try {
      await withTimeout(
        registry.ensureBackendReady(backend.id),
        timeoutMs,
        `Storage backend ${backend.id} startup check`
      );
      logger?.info?.(`[storage] Startup storage ready for ${backend.type} backend ${backend.id}`);
    } catch (error) {
      logger?.error?.(
        `[storage] Startup storage check failed for ${backend.type} backend ${backend.id}: ${formatStartupWarmupError(error)}`
      );
    }
  }
}
