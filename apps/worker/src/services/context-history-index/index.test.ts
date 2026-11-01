import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const paths = vi.hoisted(() => ({ cacheRoot: "" }));
// While set, embedding history items waits on it; query embeddings never wait.
const embedding = vi.hoisted(() => ({ gate: null as Promise<void> | null }));
paths.cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-history-index-"));

vi.mock("../../lib/config.js", () => ({
  config: {
    db: { url: "postgres://postgres:postgres@127.0.0.1:1/meowbert-test" },
    memory: { get indexCacheRoot() { return paths.cacheRoot; } },
    runtime: { tasksRoot: "/tmp/meowbert-runtime-tasks", workerConcurrency: 1 }
  }
}));

vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../tasks/task-history-reader.js", () => ({
  readTaskPayloads: vi.fn(async (_taskId, _kind, rows) => rows)
}));

vi.mock("@meowbert/run-executor/agent/openai-client", () => ({
  getOpenAiClient: () => ({
    embeddings: {
      create: async ({ input }: { input: string[] }) => {
        if (embedding.gate && input.some((text) => text.includes("\n\n"))) await embedding.gate;
        return { data: input.map((text, index) => {
          const lower = text.toLowerCase();
          return { index, embedding: [lower.includes("pnpm") ? 10 : 0, lower.includes("deploy") ? 10 : 0, 1] };
        }) };
      }
    }
  })
}));

import { query } from "../../lib/db.js";
import { readTaskPayloads } from "../tasks/task-history-reader.js";
import { applyHistoryIndexDeletions, indexTaskHistory, searchTaskHistory } from "./index.js";
import { openHistoryConnection, openHistoryTable, writeDeletionCursor } from "./storage.js";

const taskId = "11111111-1111-4111-8111-111111111111";
const state = { taskId, windowId: "w3", contextNodeId: "node-3" };
const message = (role: string, content: string) => ({ role, content });

// w1 and w3 are on the run's lineage; w2 belongs to another branch.
const items: Record<string, Array<{ id: string; ordinal: number; call_number: number | null; payload_json: unknown }>> = {
  w1: [
    { id: "item-1", ordinal: 1, call_number: null, payload_json: message("user", "Deploy the payments service") },
    { id: "item-2", ordinal: 2, call_number: 3, payload_json: { type: "function_call_output", call_id: "c1", output: "pnpm install finished" } }
  ],
  w2: [{ id: "item-3", ordinal: 1, call_number: null, payload_json: message("user", "pnpm on the other branch") }],
  w3: [{ id: "item-4", ordinal: 1, call_number: null, payload_json: message("assistant", "Writing the release notes") }]
};
let historySearchEnabled = true;
let queuedDeletions: string[] = [];

function fakeQuery(sql: string, params: unknown[] = []) {
  if (sql.startsWith("DELETE FROM history_index_deletions")) return { rows: [] };
  if (sql.includes("history_index_deletions")) return { rows: [{ checked_at: new Date(), task_ids: queuedDeletions }] };
  if (sql.includes("memory_search_enabled")) return { rows: [{ memory_search_enabled: true, history_search_enabled: historySearchEnabled }] };
  if (sql.includes("memory_embedding_settings")) return { rows: [{ model: "test-embedding", index_generation: 1, base_url: "https://embeddings.test/v1", api_key: "key" }] };
  if (sql.includes("task_history_state")) return { rows: [{ archived: false }] };
  if (sql.includes("closed_at FROM task_context_windows")) {
    return { rows: [{ id: "w1", closed_at: "2026-01-01" }, { id: "w2", closed_at: null }, { id: "w3", closed_at: null }] };
  }
  if (sql.includes("context_lineage")) return { rows: [{ id: "w1", ordinal: 1 }, { id: "w3", ordinal: 3 }] };
  if (sql.includes("FROM task_context_history_items")) {
    const [windowId, after] = params as [string, number];
    return { rows: (items[windowId] ?? []).filter((item) => item.ordinal > after) };
  }
  throw new Error(`Unexpected query: ${sql}`);
}

async function countTaskRows(): Promise<number> {
  const connection = await openHistoryConnection();
  try {
    const table = await openHistoryTable(connection);
    return table ? table.countRows(`task_id = '${taskId}'`) : 0;
  } finally {
    connection.close();
  }
}

beforeEach(async () => {
  historySearchEnabled = true;
  queuedDeletions = [];
  vi.mocked(readTaskPayloads).mockImplementation(async (_taskId, _kind, rows) => rows);
  vi.mocked(query).mockImplementation((async (sql: string, params?: unknown[]) => fakeQuery(sql, params)) as never);
  fs.rmSync(path.join(paths.cacheRoot, "v1"), { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(paths.cacheRoot, { recursive: true, force: true });
});

describe("session history search", () => {
  it("finds items on the run's lineage and leaves out other branches", async () => {
    const result = await searchTaskHistory(state, { query: "pnpm", limit: 10, window_id: null, role: null, tool: null });

    const itemIds = result.items.map((item) => item.item_id);
    expect(itemIds).toContain("item-2");
    expect(itemIds).not.toContain("item-3");
    expect(result.items.find((item) => item.item_id === "item-2")).toMatchObject({ window_id: "w1", call_number: 3, role: "tool" });
  });

  it("indexes each item once across repeated passes", async () => {
    await indexTaskHistory(taskId);
    const rows = await countTaskRows();
    await indexTaskHistory(taskId);

    expect(rows).toBe(4);
    expect(await countTaskRows()).toBe(rows);
  });
  it("rebuilds searchable excerpts when closed-window database payloads are cold", async () => {
    vi.mocked(query).mockImplementation((async (sql: string, params?: unknown[]) => {
      const result = fakeQuery(sql, params);
      return sql.includes("FROM task_context_history_items")
        ? { rows: result.rows.map((row) => ({ ...row, payload_json: {} })) } : result;
    }) as never);
    vi.mocked(readTaskPayloads).mockImplementation(async (_taskId, _kind, rows) => rows.map((row) => ({
      ...row, payload_json: Object.values(items).flat().find((item) => item.id === (row as { id: string }).id)?.payload_json
    })));
    await indexTaskHistory(taskId);
    const result = await searchTaskHistory(state, { query: "pnpm", limit: 10, window_id: null, role: null, tool: null });
    expect(result.items.find((item) => item.item_id === "item-2")?.excerpt).toContain("pnpm install finished");
  });

  it("drops archived or deleted tasks queued for removal and keeps the rest", async () => {
    await indexTaskHistory(taskId);
    await applyHistoryIndexDeletions();
    expect(await countTaskRows()).toBe(4);

    queuedDeletions = [taskId];
    await applyHistoryIndexDeletions();
    expect(await countTaskRows()).toBe(0);
  });

  it("starts over on a host that missed more of the queue than is kept", async () => {
    await indexTaskHistory(taskId);
    await writeDeletionCursor({ checkedAt: new Date(Date.now() - 40 * 24 * 60 * 60_000).toISOString() });
    await applyHistoryIndexDeletions();

    expect(await countTaskRows()).toBe(0);
  });

  it("answers from what is indexed while a long catch-up carries on", async () => {
    let release = () => {};
    embedding.gate = new Promise<void>((resolve) => { release = resolve; });
    const search = () => searchTaskHistory(state, { query: "pnpm", limit: 10, window_id: null, role: null, tool: null });

    const early = await search();
    expect(early.notice).toBeTruthy();
    expect(early.items).toEqual([]);

    release();
    embedding.gate = null;
    await indexTaskHistory(taskId);
    const later = await search();
    expect(later.notice).toBeUndefined();
    expect(later.items.map((item) => item.item_id)).toContain("item-2");
  }, 15_000);

  it("indexes nothing while session history search is switched off", async () => {
    historySearchEnabled = false;
    const result = await searchTaskHistory(state, { query: "pnpm", limit: 10, window_id: null, role: null, tool: null });

    expect(result.items).toEqual([]);
    expect(result.error).toBeTruthy();
    expect(await countTaskRows()).toBe(0);
  });
});
