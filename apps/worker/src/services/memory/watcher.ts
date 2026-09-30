import fsPromises from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import type { Connection, Table } from "@lancedb/lancedb";
import { buildIndexRows, diffTrackedFiles, resolveMemoryEmbeddingConfig, scanMemoryFiles } from "./indexing.js";
import {
  MEMORY_INDEX_DEBOUNCE_MS,
  MEMORY_TABLE_NAME,
  createMemorySyncStatus,
  ensureWorkspaceMemoryDir,
  getWorkspaceMemoryPaths,
  nowIso,
  readMemoryManifest,
  readPersistedStatus,
  writeMemoryManifest,
  writeMemorySyncStatus,
  type ResolvedMemoryEmbeddingConfig,
  type MemoryTrackedFile,
  type WorkspaceMemoryPaths
} from "./shared.js";
import {
  buildRelativePathPredicate,
  closeMemoryWriteLockPool,
  ensureTableIndices,
  maybeOptimizeTable,
  openMemoryConnection,
  openMemoryTable,
  withWorkspaceMemoryWriteLock
} from "./storage.js";

interface WorkspaceMemoryWatcherEntry {
  workspaceRoot: string;
  paths: WorkspaceMemoryPaths;
  connection: Connection | null;
  watcher: FSWatcher | null;
  initPromise: Promise<void> | null;
  syncPromise: Promise<void>;
  debounceTimer: NodeJS.Timeout | null;
  lastOptimizeAtMs: number;
  stopped: boolean;
}

const watcherEntries = new Map<string, WorkspaceMemoryWatcherEntry>();

async function createTableFromFiles(input: {
  connection: Connection;
  files: MemoryTrackedFile[];
  optimizeState: { lastOptimizeAtMs: number };
  embeddingConfig: ResolvedMemoryEmbeddingConfig;
}): Promise<Table | null> {
  const rows = await buildIndexRows(input.files, input.embeddingConfig);
  if (rows.length === 0) {
    return null;
  }

  const table = await input.connection.createTable(MEMORY_TABLE_NAME, rows, {
    mode: "create",
    existOk: false
  });
  await ensureTableIndices(table);
  await maybeOptimizeTable(input.optimizeState, table);
  return table;
}

async function persistReadyStatus(input: {
  entry: WorkspaceMemoryWatcherEntry;
  startedAt: string;
  searchTarget: "lancedb" | "none";
  detail?: string | null;
}): Promise<void> {
  await writeMemorySyncStatus(input.entry.paths, createMemorySyncStatus({
    state: "ready",
    searchTarget: input.searchTarget,
    detail: input.detail ?? null,
    lastStartedAt: input.startedAt,
    lastSuccessfulAt: nowIso()
  }));
}

async function handleEmptyMemory(entry: WorkspaceMemoryWatcherEntry, connection: Connection, startedAt: string): Promise<void> {
  const table = await openMemoryTable(connection);
  if (table) {
    await connection.dropTable(MEMORY_TABLE_NAME).catch(() => undefined);
  }
  await fsPromises.rm(entry.paths.manifestPath, { force: true });
  await persistReadyStatus({
    entry,
    startedAt,
    searchTarget: "none",
    detail: "Memory is empty."
  });
}

async function rebuildMemoryIndex(input: {
  entry: WorkspaceMemoryWatcherEntry;
  connection: Connection;
  startedAt: string;
  currentFiles: MemoryTrackedFile[];
  embeddingConfig: ResolvedMemoryEmbeddingConfig;
}): Promise<void> {
  await input.connection.dropTable(MEMORY_TABLE_NAME).catch(() => undefined);

  const table = await createTableFromFiles({
    connection: input.connection,
    files: input.currentFiles,
    optimizeState: input.entry,
    embeddingConfig: input.embeddingConfig
  });
  await writeMemoryManifest(input.entry.paths, input.currentFiles, input.embeddingConfig.configHash);
  await persistReadyStatus({
    entry: input.entry,
    startedAt: input.startedAt,
    searchTarget: table ? "lancedb" : "none",
    detail: table ? null : "Memory is empty."
  });
}

async function applyIncrementalMemoryChanges(input: {
  entry: WorkspaceMemoryWatcherEntry;
  connection: Connection;
  startedAt: string;
  currentFiles: MemoryTrackedFile[];
  table: Table;
  embeddingConfig: ResolvedMemoryEmbeddingConfig;
  changedFiles: MemoryTrackedFile[];
  removedPaths: string[];
}): Promise<void> {
  if (input.removedPaths.length > 0) {
    await input.table.delete(buildRelativePathPredicate(input.removedPaths));
  }

  if (input.changedFiles.length > 0) {
    const rowsToAdd = await buildIndexRows(input.changedFiles, input.embeddingConfig);
    if (rowsToAdd.length > 0) {
      await input.table.add(rowsToAdd);
      await ensureTableIndices(input.table);
      await maybeOptimizeTable(input.entry, input.table);
    }
  }

  await writeMemoryManifest(input.entry.paths, input.currentFiles, input.embeddingConfig.configHash);
  await persistReadyStatus({
    entry: input.entry,
    startedAt: input.startedAt,
    searchTarget: "lancedb"
  });
}

async function syncWorkspaceMemoryWithinLock(entry: WorkspaceMemoryWatcherEntry, startedAt: string): Promise<void> {
  const currentFiles = await scanMemoryFiles(entry.paths.memoryDir);
  const embeddingConfig = await resolveMemoryEmbeddingConfig();
  const manifest = await readMemoryManifest(entry.paths);
  const connection = entry.connection ?? await openMemoryConnection(entry.paths);
  const shouldCloseConnection = entry.connection === null;

  try {
    const table = await openMemoryTable(connection);
    if (currentFiles.length === 0) {
      await handleEmptyMemory(entry, connection, startedAt);
      return;
    }

    const needsFullRebuild = !table || !manifest || manifest.embedding_config_hash !== embeddingConfig.configHash;
    if (needsFullRebuild) {
      await rebuildMemoryIndex({
        entry,
        connection,
        startedAt,
        currentFiles,
        embeddingConfig
      });
      return;
    }

    const changes = diffTrackedFiles(manifest.files, currentFiles);
    if (changes.added.length === 0 && changes.modified.length === 0 && changes.removed.length === 0) {
      await persistReadyStatus({
        entry,
        startedAt,
        searchTarget: "lancedb"
      });
      return;
    }

    if (!table) {
      await rebuildMemoryIndex({
        entry,
        connection,
        startedAt,
        currentFiles,
        embeddingConfig
      });
      return;
    }

    await applyIncrementalMemoryChanges({
      entry,
      connection,
      startedAt,
      currentFiles,
      table,
      embeddingConfig,
      changedFiles: [...changes.added, ...changes.modified],
      removedPaths: [...changes.removed, ...changes.modified.map((file) => file.relativePath)]
    });
  } finally {
    if (shouldCloseConnection) {
      connection.close();
    }
  }
}

async function writeIndexingStartedStatus(entry: WorkspaceMemoryWatcherEntry, startedAt: string): Promise<string | null> {
  const previousStatus = await readPersistedStatus(entry.paths);
  await writeMemorySyncStatus(entry.paths, createMemorySyncStatus({
    state: "indexing",
    searchTarget: previousStatus?.search_target === "lancedb" ? "lancedb" : "none",
    detail: "Syncing workspace Memory in the background.",
    lastStartedAt: startedAt,
    lastSuccessfulAt: previousStatus?.last_successful_at ?? null
  }));
  return previousStatus?.last_successful_at ?? null;
}

async function syncWorkspaceMemory(entry: WorkspaceMemoryWatcherEntry): Promise<void> {
  const startedAt = nowIso();
  const lastSuccessfulAt = await writeIndexingStartedStatus(entry, startedAt);

  try {
    await withWorkspaceMemoryWriteLock(entry.workspaceRoot, async () => {
      await syncWorkspaceMemoryWithinLock(entry, startedAt);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeMemorySyncStatus(entry.paths, createMemorySyncStatus({
      state: "error",
      searchTarget: (await readPersistedStatus(entry.paths))?.search_target === "lancedb" ? "lancedb" : "none",
      detail: "Workspace Memory indexing failed.",
      error: message,
      lastStartedAt: startedAt,
      lastSuccessfulAt
    }));
    console.warn(`[memory] Failed to sync workspace Memory for ${entry.workspaceRoot}: ${message}`);
  }
}

function queueWorkspaceSync(entry: WorkspaceMemoryWatcherEntry): Promise<void> {
  entry.syncPromise = entry.syncPromise.catch(() => undefined).then(async () => {
    if (entry.stopped) {
      return;
    }
    await syncWorkspaceMemory(entry);
  });

  return entry.syncPromise;
}

function scheduleWorkspaceSync(entry: WorkspaceMemoryWatcherEntry): void {
  if (entry.debounceTimer) {
    clearTimeout(entry.debounceTimer);
  }

  entry.debounceTimer = setTimeout(() => {
    entry.debounceTimer = null;
    void queueWorkspaceSync(entry);
  }, MEMORY_INDEX_DEBOUNCE_MS);
}

function attachWatcherEventHandlers(entry: WorkspaceMemoryWatcherEntry): void {
  const handleFsEvent = (): void => {
    scheduleWorkspaceSync(entry);
  };

  entry.watcher
    ?.on("add", handleFsEvent)
    .on("change", handleFsEvent)
    .on("unlink", handleFsEvent)
    .on("addDir", handleFsEvent)
    .on("unlinkDir", handleFsEvent)
    .on("error", async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await writeMemorySyncStatus(entry.paths, createMemorySyncStatus({
        state: "error",
        searchTarget: "none",
        detail: "Workspace Memory watcher failed.",
        error: message,
        lastStartedAt: null,
        lastSuccessfulAt: (await readPersistedStatus(entry.paths))?.last_successful_at ?? null
      }));
    });
}

async function initializeWatcherEntry(entry: WorkspaceMemoryWatcherEntry): Promise<void> {
  if (entry.initPromise) {
    return entry.initPromise;
  }

  entry.initPromise = (async () => {
    await ensureWorkspaceMemoryDir(entry.workspaceRoot);
    await fsPromises.mkdir(entry.paths.indexDir, { recursive: true });
    entry.connection = await openMemoryConnection(entry.paths);
    entry.watcher = chokidar.watch(entry.paths.memoryDir, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    });

    attachWatcherEventHandlers(entry);
    void queueWorkspaceSync(entry);
  })();

  return entry.initPromise;
}

function getOrCreateWatcherEntry(workspaceRoot: string): WorkspaceMemoryWatcherEntry {
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const existing = watcherEntries.get(resolvedWorkspaceRoot);
  if (existing) {
    return existing;
  }

  const entry: WorkspaceMemoryWatcherEntry = {
    workspaceRoot: resolvedWorkspaceRoot,
    paths: getWorkspaceMemoryPaths(resolvedWorkspaceRoot),
    connection: null,
    watcher: null,
    initPromise: null,
    syncPromise: Promise.resolve(),
    debounceTimer: null,
    lastOptimizeAtMs: 0,
    stopped: false
  };
  watcherEntries.set(resolvedWorkspaceRoot, entry);
  return entry;
}

export function ensureWorkspaceMemoryWatcher(workspaceRoot: string): void {
  const entry = getOrCreateWatcherEntry(workspaceRoot);
  void initializeWatcherEntry(entry).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error);
    await writeMemorySyncStatus(entry.paths, createMemorySyncStatus({
      state: "error",
      searchTarget: "none",
      detail: "Workspace Memory initialization failed.",
      error: message,
      lastStartedAt: null,
      lastSuccessfulAt: (await readPersistedStatus(entry.paths))?.last_successful_at ?? null
    }));
    console.warn(`[memory] Failed to initialize workspace Memory watcher for ${workspaceRoot}: ${message}`);
  });
}

export async function syncWorkspaceMemoryNow(workspaceRoot: string): Promise<void> {
  const entry = getOrCreateWatcherEntry(workspaceRoot);
  await initializeWatcherEntry(entry);
  await queueWorkspaceSync(entry);
}

export async function stopWorkspaceMemoryWatchers(): Promise<void> {
  const entries = [...watcherEntries.values()];
  watcherEntries.clear();

  await Promise.all(entries.map(async (entry) => {
    entry.stopped = true;
    if (entry.debounceTimer) {
      clearTimeout(entry.debounceTimer);
      entry.debounceTimer = null;
    }
    await entry.watcher?.close().catch(() => undefined);
    await entry.syncPromise.catch(() => undefined);
    entry.connection?.close();
  }));
  await closeMemoryWriteLockPool();
}
