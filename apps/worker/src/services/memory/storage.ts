import path from "node:path";
import { Pool } from "pg";
import { connect, Index, type Connection, type Table } from "@lancedb/lancedb";
import { config } from "../../lib/config.js";
import {
  MEMORY_INDEX_MIN_ROWS,
  MEMORY_OPTIMIZE_MIN_INTERVAL_MS,
  MEMORY_TABLE_NAME,
  createMemorySyncStatus,
  getWorkspaceMemoryPaths,
  readPersistedStatus,
  type MemorySyncStatus,
  type WorkspaceMemoryPaths
} from "./shared.js";

const localWriteLocks = new Map<string, Promise<void>>();
const MEMORY_LOCK_POOL_CONNECTION_TIMEOUT_MS = 30_000;
const MEMORY_LOCK_POOL_MAX_CONNECTIONS = Math.max(1, Math.min(4, config.runtime.workerConcurrency));
const OPTIONAL_MEMORY_LOCK_ERROR_PATTERNS: readonly RegExp[] = [
  /\bECONNREFUSED\b/i,
  /\bEPERM\b/i,
  /\bENOTFOUND\b/i,
  /\bEHOSTUNREACH\b/i,
  /\bEAI_AGAIN\b/i,
  /\bcould not connect to server\b/i,
  /\boperation not permitted\b/i,
];
const RECOVERABLE_MEMORY_TABLE_ERROR_PATTERNS: readonly RegExp[] = [
  /table ['"]memory_chunks_v1['"] was not found/i,
  /memory_chunks_v1\.lance\/_versions/i,
  /memory_chunks_v1\.lance .* was not found/i,
  /dataset at path .*memory_chunks_v1\.lance .* not found/i,
];

let memoryLockPool: Pool | null = null;

function getMemoryLockPool(): Pool {
  if (memoryLockPool) {
    return memoryLockPool;
  }

  memoryLockPool = new Pool({
    connectionString: config.db.url,
    max: MEMORY_LOCK_POOL_MAX_CONNECTIONS,
    connectionTimeoutMillis: MEMORY_LOCK_POOL_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
  });
  memoryLockPool.on("error", (error) => {
    console.error("[memory] Unexpected PostgreSQL lock-pool error", error);
  });
  return memoryLockPool;
}

function getErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const cause = error instanceof Error && error.cause
    ? error.cause instanceof Error
      ? error.cause.message
      : String(error.cause)
    : "";

  return `${message}\n${cause}`.trim();
}

function shouldUseLocalMemoryLockFallback(error: unknown): boolean {
  if (!process.env.VITEST) {
    return false;
  }

  const text = getErrorText(error);
  return OPTIONAL_MEMORY_LOCK_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

function isRecoverableMissingMemoryTableError(error: unknown): boolean {
  const text = getErrorText(error);
  return RECOVERABLE_MEMORY_TABLE_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

async function withLocalWorkspaceMemoryWriteLock<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = path.resolve(workspaceRoot);
  while (localWriteLocks.has(lockKey)) {
    await localWriteLocks.get(lockKey);
  }

  let releaseLock: () => void = () => undefined;
  const lockPromise = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  localWriteLocks.set(lockKey, lockPromise);

  try {
    return await fn();
  } finally {
    releaseLock();
    if (localWriteLocks.get(lockKey) === lockPromise) {
      localWriteLocks.delete(lockKey);
    }
  }
}

function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildRelativePathPredicate(relativePaths: string[]): string {
  const uniquePaths = Array.from(new Set(relativePaths.map((value) => value.trim()).filter((value) => value.length > 0)));
  if (uniquePaths.length === 0) {
    return "false";
  }

  return `relative_path IN (${uniquePaths.map((value) => `'${escapeSqlString(value)}'`).join(", ")})`;
}

export async function openMemoryConnection(paths: WorkspaceMemoryPaths): Promise<Connection> {
  await import("node:fs/promises").then(({ default: fsPromises }) => fsPromises.mkdir(paths.dbDir, { recursive: true }));
  return connect(paths.dbDir);
}

export async function openMemoryTable(connection: Connection): Promise<Table | null> {
  const tableNames = await connection.tableNames();
  if (!tableNames.includes(MEMORY_TABLE_NAME)) {
    return null;
  }

  try {
    return await connection.openTable(MEMORY_TABLE_NAME);
  } catch (error) {
    if (isRecoverableMissingMemoryTableError(error)) {
      return null;
    }
    throw error;
  }
}

export async function memoryTableExists(paths: WorkspaceMemoryPaths): Promise<boolean> {
  const connection = await openMemoryConnection(paths);
  try {
    return (await connection.tableNames()).includes(MEMORY_TABLE_NAME);
  } finally {
    connection.close();
  }
}

export async function readMemorySyncStatus(workspaceRoot: string): Promise<MemorySyncStatus> {
  const paths = getWorkspaceMemoryPaths(workspaceRoot);
  const status = await readPersistedStatus(paths);
  if (status) {
    return status;
  }

  if (await memoryTableExists(paths)) {
    return createMemorySyncStatus({
      state: "ready",
      searchTarget: "lancedb"
    });
  }

  return createMemorySyncStatus({
    state: "ready",
    searchTarget: "none",
    detail: "Memory is empty."
  });
}

export async function ensureTableIndices(table: Table): Promise<void> {
  const rowCount = await table.countRows();
  if (rowCount < MEMORY_INDEX_MIN_ROWS) {
    return;
  }

  try {
    await table.createIndex("relative_path", { replace: false });
  } catch {
    // Best effort only.
  }

  try {
    await table.createIndex("vector", {
      replace: false,
      config: Index.hnswSq({ distanceType: "cosine" })
    });
  } catch {
    // Best effort only.
  }
}

export async function maybeOptimizeTable(optimizeState: { lastOptimizeAtMs: number }, table: Table): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - optimizeState.lastOptimizeAtMs < MEMORY_OPTIMIZE_MIN_INTERVAL_MS) {
    return;
  }

  optimizeState.lastOptimizeAtMs = nowMs;
  try {
    await table.optimize();
  } catch {
    // Best effort only.
  }
}

export async function withWorkspaceMemoryWriteLock<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
  return withLocalWorkspaceMemoryWriteLock(workspaceRoot, async () => {
    const lockKey = `workspace_memory:${path.resolve(workspaceRoot)}`;

    try {
      const client = await getMemoryLockPool().connect();
      try {
        await client.query(`SELECT pg_advisory_lock(hashtext($1))`, [lockKey]);
        return await fn();
      } finally {
        try {
          await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [lockKey]);
        } finally {
          client.release();
        }
      }
    } catch (error) {
      if (shouldUseLocalMemoryLockFallback(error)) {
        console.warn(
          `[memory] Falling back to local-only write lock for ${workspaceRoot}: ${getErrorText(error)}`
        );
        return await fn();
      }

      throw error;
    }
  });
}

export async function closeMemoryWriteLockPool(): Promise<void> {
  if (!memoryLockPool) {
    return;
  }

  const poolToClose = memoryLockPool;
  memoryLockPool = null;
  await poolToClose.end().catch(() => undefined);
}
