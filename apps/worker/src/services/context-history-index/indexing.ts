import type { ResponseInputItem } from "openai/resources/responses/responses";
import { readEmbeddingFeatures } from "@meowbert/shared";
import { toHistoryFileLine } from "@meowbert/run-executor/context-management-v2/history-item";
import { query } from "../../lib/db.js";
import { chunkMemoryFile } from "../memory/chunking.js";
import { resolveMemoryEmbeddingConfig } from "../memory/embedding-config.js";
import { applyEmbeddingTemplate, embedTexts } from "../memory/indexing.js";
import { MEMORY_SEARCH_TEXT_COLUMN, type ResolvedMemoryEmbeddingConfig } from "../memory/shared.js";
import { maybeOptimizeTable } from "../memory/storage.js";
import {
  HISTORY_TABLE_NAME,
  dropHistoryIndex,
  ensureHistoryTableIndices,
  openHistoryConnection,
  openHistoryTable,
  readTaskWatermark,
  resetHistoryIndexIfStale,
  withHistoryIndexWriteLock,
  writeTaskWatermark,
  type HistoryIndexRow,
  type TaskHistoryWatermark
} from "./storage.js";

// Only the start of a very long item is embedded; the history file keeps all of it.
const MAX_EMBEDDED_CHARS_PER_ITEM = 16_000;
const ITEMS_PER_BATCH = 128;
const INDEX_DEBOUNCE_MS = 2_000;
const FEATURES_CACHE_MS = 30_000;

interface WindowRow { id: string; closed_at: string | null }
interface ItemRow { id: string; ordinal: number; call_number: number | null; payload_json: ResponseInputItem }

const optimizeState = { lastOptimizeAtMs: 0 };
const pendingTimers = new Map<string, NodeJS.Timeout>();
const runningIndexes = new Map<string, Promise<void>>();
let cachedFeatures: { enabled: boolean; readAt: number } | null = null;

// Read on every recorded turn, so it is cached briefly.
async function isHistorySearchEnabled(): Promise<boolean> {
  if (cachedFeatures && Date.now() - cachedFeatures.readAt < FEATURES_CACHE_MS) return cachedFeatures.enabled;
  const { historySearchEnabled } = await readEmbeddingFeatures(query);
  cachedFeatures = { enabled: historySearchEnabled, readAt: Date.now() };
  return historySearchEnabled;
}

function buildChunks(taskId: string, windowId: string, item: ItemRow) {
  const line = toHistoryFileLine({ id: item.id, callNumber: item.call_number, item: item.payload_json });
  const text = line.content.slice(0, MAX_EMBEDDED_CHARS_PER_ITEM);
  return chunkMemoryFile("history.log", text).chunks.map((chunk, index) => ({
    id: `${item.id}:${index}`,
    task_id: taskId,
    window_id: windowId,
    item_id: item.id,
    ordinal: item.ordinal,
    call_number: item.call_number ?? 0,
    role: line.role,
    tool: line.tool ?? "",
    [MEMORY_SEARCH_TEXT_COLUMN]: chunk.text
  }));
}

async function embedRows(chunks: ReturnType<typeof buildChunks>, config: ResolvedMemoryEmbeddingConfig): Promise<HistoryIndexRow[]> {
  const inputs = chunks.map((chunk) => applyEmbeddingTemplate(
    config.buildPromptTemplate,
    `${chunk.role}${chunk.tool ? ` ${chunk.tool}` : ""}\n\n${chunk[MEMORY_SEARCH_TEXT_COLUMN]}`
  ));
  const vectors = await embedTexts(inputs, config);
  return chunks.map((chunk, index) => ({ ...chunk, vector: vectors[index] }));
}

// Adds rows past the stored watermark, so a pass on another worker that got there first is not
// indexed twice. The watermark is re-read under the lock for the same reason.
async function writeRows(input: {
  taskId: string;
  windowId: string;
  rows: HistoryIndexRow[];
  lastOrdinal: number;
  closed: boolean;
  configHash: string;
}): Promise<TaskHistoryWatermark> {
  return withHistoryIndexWriteLock(async () => {
    const connection = await openHistoryConnection();
    try {
      await resetHistoryIndexIfStale(connection, input.configHash);
      const watermark = await readTaskWatermark(input.taskId);
      const indexed = watermark.windows[input.windowId] ?? 0;
      const rows = input.rows.filter((row) => row.ordinal > indexed);
      let table = await openHistoryTable(connection);
      const indexedSize = (await table?.schema())?.fields.find((field) => field.name === "vector")?.type as { listSize?: number } | undefined;
      if (table && rows[0] && indexedSize?.listSize !== undefined && indexedSize.listSize !== rows[0].vector.length) {
        await dropHistoryIndex(connection);
        table = null;
      }
      if (rows.length > 0) {
        if (table) await table.add(rows);
        else table = await connection.createTable(HISTORY_TABLE_NAME, rows);
        await ensureHistoryTableIndices(table);
        await maybeOptimizeTable(optimizeState, table);
      }
      const next = await readTaskWatermark(input.taskId);
      next.windows[input.windowId] = Math.max(next.windows[input.windowId] ?? 0, input.lastOrdinal);
      if (input.closed && !next.doneWindows.includes(input.windowId)) next.doneWindows.push(input.windowId);
      await writeTaskWatermark(input.taskId, next);
      return next;
    } finally {
      connection.close();
    }
  });
}

async function indexWindow(taskId: string, window: WindowRow, watermark: TaskHistoryWatermark, config: ResolvedMemoryEmbeddingConfig) {
  let after = watermark.windows[window.id] ?? 0;
  for (;;) {
    const items = await query<ItemRow>(
      `SELECT id, ordinal, call_number, payload_json
         FROM task_context_history_items
        WHERE window_id = $1 AND ordinal > $2
        ORDER BY ordinal ASC
        LIMIT $3`,
      [window.id, after, ITEMS_PER_BATCH]
    );
    const last = items.rows.at(-1);
    const drained = items.rows.length < ITEMS_PER_BATCH;
    if (!last) {
      if (window.closed_at) await writeRows({ taskId, windowId: window.id, rows: [], lastOrdinal: after, closed: true, configHash: config.configHash });
      return;
    }
    const rows = await embedRows(items.rows.flatMap((item) => buildChunks(taskId, window.id, item)), config);
    await writeRows({ taskId, windowId: window.id, rows, lastOrdinal: last.ordinal, closed: drained && window.closed_at !== null, configHash: config.configHash });
    after = last.ordinal;
    if (drained) return;
  }
}

async function indexTask(taskId: string): Promise<void> {
  const task = await query<{ archived: boolean }>(
    "SELECT task_history_archived_at IS NOT NULL AS archived FROM tasks WHERE id = $1",
    [taskId]
  );
  if (!task.rows[0] || task.rows[0].archived) return;
  const config = await resolveMemoryEmbeddingConfig();
  const watermark = await readTaskWatermark(taskId);
  const windows = await query<WindowRow>(
    "SELECT id, closed_at FROM task_context_windows WHERE task_id = $1 ORDER BY ordinal ASC",
    [taskId]
  );
  for (const window of windows.rows) {
    if (watermark.doneWindows.includes(window.id)) continue;
    await indexWindow(taskId, window, watermark, config);
  }
}

// Brings the task's index up to date; concurrent calls for one task share a single pass.
export function indexTaskHistory(taskId: string): Promise<void> {
  const running = runningIndexes.get(taskId);
  if (running) return running.then(() => indexTaskHistory(taskId));
  const pass = indexTask(taskId).finally(() => runningIndexes.delete(taskId));
  runningIndexes.set(taskId, pass);
  return pass;
}

// Called after items are recorded. Never blocks the run, and does nothing while the admin has
// session history search switched off.
export function scheduleTaskHistoryIndex(taskId: string): void {
  if (pendingTimers.has(taskId)) return;
  pendingTimers.set(taskId, setTimeout(() => {
    pendingTimers.delete(taskId);
    void isHistorySearchEnabled()
      .then((enabled) => enabled ? indexTaskHistory(taskId) : undefined)
      .catch((error: unknown) => {
        console.warn(`[history-index] Could not index task ${taskId}: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, INDEX_DEBOUNCE_MS));
}
