import fs from "node:fs/promises";
import path from "node:path";
import type { ContextHistoryRecord, ContextWindowRef, RunContextStore } from "../agent/ports/run-control.js";
import { toHistoryFileLine } from "./history-item.js";

// Each window on the run's lineage is one JSONL file, `<ordinal>-<window id>.jsonl`, that the agent
// reads with ordinary file tools. Postgres stays the source of truth: the files are rebuilt from
// it when a window opens and appended to as items are recorded.

export function historyFileName(window: { windowId: string; ordinal: number }): string {
  return `${String(window.ordinal).padStart(4, "0")}-${window.windowId}.jsonl`;
}

function serializeLines(records: Array<{ id: string; callNumber: number | null; item: ContextHistoryRecord["item"] }>): string {
  return records.map((record) => `${JSON.stringify(toHistoryFileLine(record))}\n`).join("");
}

const TAIL_CHUNK_BYTES = 64 * 1024;
const LAST_LINE_ID = /^\{"id":"([^"\\]*)"/;

// Whether the file's last complete line is the given item, read from the end so a large file is
// not read whole. Each line starts with its item id.
async function fileEndsWithItem(filePath: string, itemId: string | null): Promise<boolean> {
  const handle = await fs.open(filePath, "r").catch(() => null);
  if (!handle) return false;
  try {
    const { size } = await handle.stat();
    if (size === 0) return itemId === null;
    const lastByte = Buffer.alloc(1);
    await handle.read(lastByte, 0, 1, size - 1);
    // A line cut short by a crash means the file needs rebuilding.
    if (itemId === null || lastByte[0] !== 0x0a) return false;
    let searchEnd = size - 1;
    let lineStart = 0;
    while (searchEnd > 0) {
      const start = Math.max(0, searchEnd - TAIL_CHUNK_BYTES);
      const chunk = Buffer.alloc(searchEnd - start);
      await handle.read(chunk, 0, chunk.length, start);
      const newline = chunk.lastIndexOf(0x0a);
      if (newline >= 0) {
        lineStart = start + newline + 1;
        break;
      }
      searchEnd = start;
    }
    const head = Buffer.alloc(Math.min(256, size - lineStart));
    await handle.read(head, 0, head.length, lineStart);
    return LAST_LINE_ID.exec(head.toString("utf8"))?.[1] === itemId;
  } finally {
    await handle.close();
  }
}

async function writeFileAtomically(filePath: string, text: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, text, { mode: 0o644 });
  await fs.rename(temporaryPath, filePath);
}

// Writes any lineage window that has no file, rewrites the open window's file when it does not end
// with the window's last item, and removes files of windows on other branches. Closed windows never
// change, so their existing files are kept.
export async function syncHistoryFiles(store: RunContextStore, window: ContextWindowRef, historyDir: string): Promise<Map<string, string>> {
  const windows = await store.listHistoryWindows(window);
  const expected = new Map(windows.map((entry) => [entry.windowId, historyFileName(entry)]));
  const expectedNames = new Set(expected.values());
  const existing = new Set((await fs.readdir(historyDir)).filter((name) => name.endsWith(".jsonl")));
  for (const name of existing) {
    if (!expectedNames.has(name)) await fs.rm(path.join(historyDir, name), { force: true });
  }
  for (const entry of windows) {
    const name = historyFileName(entry);
    if (existing.has(name)) {
      if (entry.windowId !== window.windowId) continue;
      if (entry.lastItemId !== undefined && await fileEndsWithItem(path.join(historyDir, name), entry.lastItemId)) continue;
    }
    const items = await store.loadHistoryWindow(window, entry.windowId);
    await writeFileAtomically(path.join(historyDir, name), serializeLines(items));
  }
  return expected;
}

// A context store that keeps the run's history files in step with what it records. File errors
// are logged and never fail the run; the next window open rebuilds the files.
export function withHistoryFiles(store: RunContextStore, input: { taskId: string; historyDir: string }): RunContextStore {
  const { taskId, historyDir } = input;
  const fileNames = new Map<string, string>();
  const keepGoing = (action: string) => (error: unknown) => {
    console.warn(`[history-files] Could not ${action}: ${error instanceof Error ? error.message : String(error)}`);
  };
  return {
    ...store,
    async openWindow(branchLeafMessageId) {
      const opened = await store.openWindow(branchLeafMessageId);
      const ref = { taskId, windowId: opened.windowId, contextNodeId: opened.contextNodeId };
      await syncHistoryFiles(store, ref, historyDir)
        .then((names) => names.forEach((name, windowId) => fileNames.set(windowId, name)))
        .catch(keepGoing("rebuild history files"));
      return opened;
    },
    async startNewWindow(window, branchLeafMessageId, reason) {
      const started = await store.startNewWindow(window, branchLeafMessageId, reason);
      const name = historyFileName({ windowId: started.windowId, ordinal: started.ordinal });
      fileNames.set(started.windowId, name);
      await fs.writeFile(path.join(historyDir, name), "", { mode: 0o644 }).catch(keepGoing("create a history file"));
      return started;
    },
    async recordItems(window, records) {
      await store.recordItems(window, records);
      const name = fileNames.get(window.windowId);
      if (!name || records.length === 0) return;
      const lines = serializeLines(records.map((record) => ({ id: record.id, callNumber: record.callNumber ?? null, item: record.item })));
      await fs.appendFile(path.join(historyDir, name), lines, { mode: 0o644 }).catch(keepGoing("append history items"));
    }
  };
}
