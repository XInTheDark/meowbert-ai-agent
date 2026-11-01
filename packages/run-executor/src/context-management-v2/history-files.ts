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

async function writeFileAtomically(filePath: string, text: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, text, { mode: 0o644 });
  await fs.rename(temporaryPath, filePath);
}

// Rewrites the open window's file, writes any lineage window that has none, and removes files of
// windows on other branches. Closed windows never change, so their existing files are kept.
export async function syncHistoryFiles(store: RunContextStore, window: ContextWindowRef, historyDir: string): Promise<Map<string, string>> {
  const windows = await store.listHistoryWindows(window);
  const expected = new Map(windows.map((entry) => [entry.windowId, historyFileName(entry)]));
  const expectedNames = new Set(expected.values());
  const existing = new Set((await fs.readdir(historyDir)).filter((name) => name.endsWith(".jsonl")));
  for (const name of existing) {
    if (!expectedNames.has(name)) await fs.rm(path.join(historyDir, name), { force: true });
  }
  for (const [windowId, name] of expected) {
    if (windowId !== window.windowId && existing.has(name)) continue;
    const items = await store.loadHistoryWindow(window, windowId);
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
