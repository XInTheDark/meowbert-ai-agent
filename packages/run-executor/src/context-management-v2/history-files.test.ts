import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { afterEach, describe, expect, it } from "vitest";
import type { ContextHistoryRecord, ContextWindowRef, RunContextStore, StoredContextHistoryItem } from "../agent/ports/run-control.js";
import { historyFileName, withHistoryFiles } from "./history-files.js";
import { toHistoryFileLine } from "./history-item.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createHistoryDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-history-files-"));
  directories.push(dir);
  return dir;
}

// Windows keyed by id, each on one branch; a lineage sees its own branch plus the shared windows.
function createStore(input: { lineages: Record<string, string[]> }) {
  const items = new Map<string, StoredContextHistoryItem[]>();
  const ordinals = new Map<string, number>();
  let openWindowId = "w1";
  let openNodeId = "n1";
  const addWindow = (windowId: string, ordinal: number, windowItems: StoredContextHistoryItem[] = []) => {
    ordinals.set(windowId, ordinal);
    items.set(windowId, windowItems);
  };
  const store = {
    openWindow: async () => ({ firstWindowId: "w1", windowId: openWindowId, contextNodeId: openNodeId, previousWindowId: null, ordinal: ordinals.get(openWindowId) ?? 1 }),
    listHistoryWindows: async (window: ContextWindowRef) => (input.lineages[window.contextNodeId] ?? [])
      .map((windowId) => ({ windowId, ordinal: ordinals.get(windowId) ?? 0 })),
    loadHistoryWindow: async (_window: ContextWindowRef, windowId: string) => items.get(windowId) ?? [],
    recordItems: async (window: ContextWindowRef, records: ContextHistoryRecord[]) => {
      items.get(window.windowId)?.push(...records.map((record) => ({ id: record.id, callNumber: record.callNumber ?? null, item: record.item })));
    },
    startNewWindow: async () => {
      addWindow("w2", 2);
      input.lineages.n2 = [...(input.lineages.n1 ?? []), "w2"];
      return { windowId: "w2", contextNodeId: "n2", ordinal: 2 };
    }
  } as unknown as RunContextStore;
  return {
    store,
    addWindow,
    open: (windowId: string, nodeId: string) => { openWindowId = windowId; openNodeId = nodeId; }
  };
}

const message = (text: string): ResponseInputItem => ({ role: "user", content: text });

async function readLines(dir: string, window: { windowId: string; ordinal: number }) {
  const text = await fs.readFile(path.join(dir, historyFileName(window)), "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as unknown);
}

describe("history files", () => {
  it("writes the lineage's windows when a window opens and appends recorded items", async () => {
    const dir = await createHistoryDir();
    const fake = createStore({ lineages: { n1: ["w1"] } });
    fake.addWindow("w1", 1, [{ id: "a", callNumber: null, item: message("first") }]);
    const store = withHistoryFiles(fake.store, { taskId: "task", historyDir: dir });

    const opened = await store.openWindow(null);
    await store.recordItems(opened, [{ id: "b", item: message("second") }]);

    expect(await readLines(dir, { windowId: "w1", ordinal: 1 })).toEqual([
      toHistoryFileLine({ id: "a", callNumber: null, item: message("first") }),
      toHistoryFileLine({ id: "b", callNumber: null, item: message("second") })
    ]);
  });

  it("starts a file for a new window", async () => {
    const dir = await createHistoryDir();
    const fake = createStore({ lineages: { n1: ["w1"] } });
    fake.addWindow("w1", 1);
    const store = withHistoryFiles(fake.store, { taskId: "task", historyDir: dir });
    const opened = await store.openWindow(null);

    const next = await store.startNewWindow(opened, null, "reset");
    await store.recordItems({ taskId: "task", ...next }, [{ id: "c", item: message("next window") }]);

    expect(await readLines(dir, { windowId: "w2", ordinal: 2 })).toEqual([
      toHistoryFileLine({ id: "c", callNumber: null, item: message("next window") })
    ]);
  });

  it("removes windows of another branch and repairs the open window", async () => {
    const dir = await createHistoryDir();
    const fake = createStore({ lineages: { left: ["w1", "w2"], right: ["w1", "w3"] } });
    fake.addWindow("w1", 1, [{ id: "a", callNumber: null, item: message("shared") }]);
    fake.addWindow("w2", 2, [{ id: "b", callNumber: null, item: message("left") }]);
    fake.addWindow("w3", 3, [{ id: "c", callNumber: null, item: message("right") }]);
    await fs.writeFile(path.join(dir, historyFileName({ windowId: "w3", ordinal: 3 })), "stale\n");

    fake.open("w2", "left");
    await withHistoryFiles(fake.store, { taskId: "task", historyDir: dir }).openWindow(null);

    expect((await fs.readdir(dir)).sort()).toEqual([
      historyFileName({ windowId: "w1", ordinal: 1 }),
      historyFileName({ windowId: "w2", ordinal: 2 })
    ]);
  });
});

describe("history file lines", () => {
  it("keeps reasoning summaries and drops encrypted content", () => {
    const line = toHistoryFileLine({
      id: "r",
      callNumber: null,
      item: { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "Thinking about it" }], encrypted_content: "secret" } as ResponseInputItem
    });

    expect(line).toEqual({ id: "r", call_number: null, role: "assistant", type: "reasoning", tool: null, content: "Thinking about it" });
  });

  it("uses call arguments and outputs as content", () => {
    expect(toHistoryFileLine({
      id: "call",
      callNumber: 4,
      item: { type: "function_call", call_id: "c1", name: "exec", arguments: "{\"cmd\":\"ls\"}" } as ResponseInputItem
    })).toMatchObject({ call_number: 4, tool: "exec", content: "{\"cmd\":\"ls\"}" });
    expect(toHistoryFileLine({
      id: "out",
      callNumber: 4,
      item: { type: "function_call_output", call_id: "c1", output: "file.txt" } as ResponseInputItem
    })).toMatchObject({ role: "tool", content: "file.txt" });
  });
});
