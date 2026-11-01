import fs from "node:fs/promises";
import path from "node:path";
import { connect, Index, type Connection, type Table } from "@lancedb/lancedb";
import { MEMORY_INDEX_MIN_ROWS, MEMORY_SEARCH_TEXT_COLUMN, readJsonFile, resolveMemoryIndexCacheRoot, writeJsonFileAtomic } from "../memory/shared.js";
import { withIndexWriteLock } from "../memory/storage.js";

// One session history index per host, next to the Memory index cache. Rows are filtered by task, so
// a single table serves every workspace. Each task has a watermark file: the highest ordinal indexed
// in each of its windows, and which closed windows are done.

export const HISTORY_TABLE_NAME = "history_chunks";
const HISTORY_INDEX_DIR = path.join("v1", "session-history");

export interface HistoryIndexRow {
  [key: string]: unknown;
  id: string;
  task_id: string;
  window_id: string;
  item_id: string;
  ordinal: number;
  // 0 when the item has no call number.
  call_number: number;
  role: string;
  // Empty when the item is not a tool call.
  tool: string;
  [MEMORY_SEARCH_TEXT_COLUMN]: string;
  vector: number[];
}

export interface TaskHistoryWatermark {
  windows: Record<string, number>;
  doneWindows: string[];
}

function indexDir(): string {
  return path.resolve(resolveMemoryIndexCacheRoot(), HISTORY_INDEX_DIR);
}

function watermarkPath(taskId: string): string {
  return path.join(indexDir(), "tasks", `${taskId}.json`);
}

export function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

export function withHistoryIndexWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  return withIndexWriteLock(`session_history:${indexDir()}`, fn);
}

export async function openHistoryConnection(): Promise<Connection> {
  await fs.mkdir(path.join(indexDir(), "lancedb"), { recursive: true });
  return connect(path.join(indexDir(), "lancedb"));
}

export async function openHistoryTable(connection: Connection): Promise<Table | null> {
  const { tables } = await connection.listTables();
  return tables.includes(HISTORY_TABLE_NAME) ? connection.openTable(HISTORY_TABLE_NAME) : null;
}

export async function readTaskWatermark(taskId: string): Promise<TaskHistoryWatermark> {
  return await readJsonFile<TaskHistoryWatermark>(watermarkPath(taskId)) ?? { windows: {}, doneWindows: [] };
}

export async function writeTaskWatermark(taskId: string, watermark: TaskHistoryWatermark): Promise<void> {
  await fs.mkdir(path.dirname(watermarkPath(taskId)), { recursive: true });
  await writeJsonFileAtomic(watermarkPath(taskId), watermark);
}

// The embedding settings the index was built with; a change drops the whole index, which then
// rebuilds as tasks are indexed or searched again.
export async function resetHistoryIndexIfStale(connection: Connection, configHash: string): Promise<void> {
  const manifestPath = path.join(indexDir(), "manifest.json");
  const manifest = await readJsonFile<{ configHash: string }>(manifestPath);
  if (manifest?.configHash === configHash) return;
  await dropHistoryIndex(connection);
  await writeJsonFileAtomic(manifestPath, { configHash });
}

// Also used when the embedding model starts returning vectors of a different size.
export async function dropHistoryIndex(connection: Connection): Promise<void> {
  if (await openHistoryTable(connection)) await connection.dropTable(HISTORY_TABLE_NAME);
  await fs.rm(path.join(indexDir(), "tasks"), { recursive: true, force: true });
}

export async function deleteTaskHistoryIndex(taskId: string): Promise<void> {
  await withHistoryIndexWriteLock(async () => {
    const connection = await openHistoryConnection();
    try {
      const table = await openHistoryTable(connection);
      if (table) await table.delete(`task_id = '${escapeSqlString(taskId)}'`);
      await fs.rm(watermarkPath(taskId), { force: true });
    } finally {
      connection.close();
    }
  });
}

export async function ensureHistoryTableIndices(table: Table): Promise<void> {
  try {
    await table.createIndex(MEMORY_SEARCH_TEXT_COLUMN, { replace: false, config: Index.fts({ maxTokenLength: 80 }) });
  } catch {
    // Best effort only; search falls back to vector-only.
  }
  if (await table.countRows() < MEMORY_INDEX_MIN_ROWS) return;
  for (const column of ["task_id", "window_id"]) {
    try {
      await table.createIndex(column, { replace: false });
    } catch {
      // Best effort only.
    }
  }
  try {
    await table.createIndex("vector", { replace: false, config: Index.hnswSq({ distanceType: "cosine" }) });
  } catch {
    // Best effort only.
  }
}
