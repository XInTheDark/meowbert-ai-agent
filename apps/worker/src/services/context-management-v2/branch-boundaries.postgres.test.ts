import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ContextWindowRef } from "@meowbert/run-executor/agent/ports/run-control";
import { resolveContextManagementState, searchContextNotes as searchExecutorNotes } from "@meowbert/run-executor/context-management-v2/window";

const databaseUrl = process.env.TEST_CONTEXT_DATABASE_URL;
const legacy = { taskId: randomUUID(), root: randomUUID(), node: randomUUID(), window: randomUUID(), user: randomUUID(), a1: randomUUID(), a2: randomUUID() };
const { schema } = vi.hoisted(() => ({ schema: `branch_boundaries_${process.pid}_${Date.now()}` }));
vi.mock("../../lib/db.js", async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.TEST_CONTEXT_DATABASE_URL ?? "postgres://127.0.0.1:1/none",
    options: `-c search_path=${schema}`, max: 4 });
  return { pool, query: (sql: string, params: unknown[]) => pool.query(sql, params),
    withTransaction: async (fn: (client: unknown) => Promise<unknown>) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    } };
});
vi.mock("../tasks/task-history-reader.js", () => ({ readTaskPayloads: async (_task: string, _kind: string, rows: unknown[]) => rows }));
vi.mock("../context-history-index/index.js", () => ({ scheduleTaskHistoryIndex: vi.fn(), searchTaskHistory: vi.fn() }));
const { pool } = await import("../../lib/db.js");
const { createDbContextStore } = await import("./db-store.js");
const { openContextWindow, linkVisibleContextNode, loadContextNotesSummary, recordContextHistoryRecords, startNewContextWindowRecord } = await import("./service.js");
const { listContextHistoryWindows, loadContextHistoryWindow, readContextNote, searchContextNotes } = await import("./tools.js");
const { writeContextNote } = await import("./notes.js");

async function message(taskId: string, parent: string | null) {
  const id = randomUUID();
  await pool.query("INSERT INTO task_messages VALUES ($1, $2, $3)", [id, taskId, parent]);
  return id;
}

async function fixture() {
  const taskId = randomUUID();
  await pool.query("INSERT INTO tasks VALUES ($1)", [taskId]);
  const user = await message(taskId, null);
  const window = await openContextWindow(taskId, user);
  return { taskId, user, state: { taskId, ...window } };
}

async function record(state: ContextWindowRef, role: "user" | "assistant", content: string) {
  const id = randomUUID();
  await recordContextHistoryRecords(state, [{ id, item: { role, content } }]);
  return id;
}

async function note(state: ContextWindowRef, text: string, path = "continuity.md") {
  await writeContextNote({ state, path, text, append: false });
}

describe.skipIf(!databaseUrl)("message context boundaries in PostgreSQL", () => {
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query("CREATE TABLE tasks (id uuid PRIMARY KEY); CREATE TABLE task_messages (id uuid PRIMARY KEY, task_id uuid REFERENCES tasks, parent_message_id uuid REFERENCES task_messages, created_at timestamptz DEFAULT now())");
    for (const migration of ["110_context_management_v2", "149_context_history_call_numbers", "154_context_window_prompt", "155_context_window_request"]) {
      await pool.query(await readFile(new URL(`../../../../../db/migrations/${migration}.sql`, import.meta.url), "utf8"));
    }
    await pool.query("INSERT INTO tasks VALUES ($1)", [legacy.taskId]);
    await pool.query("INSERT INTO task_messages VALUES ($1,$4,NULL,'2026-01-01'), ($2,$4,$1,'2026-01-02'), ($3,$4,$2,'2026-01-03')", [legacy.user, legacy.a1, legacy.a2, legacy.taskId]);
    await pool.query("INSERT INTO task_context_nodes (id, task_id, kind, parent_node_id, visible_message_id) VALUES ($1,$5,'visible',NULL,$6), ($2,$5,'private',$1,NULL), ($3,$5,'visible',$2,$7), ($4,$5,'visible',$2,$8)", [legacy.root, legacy.node, randomUUID(), randomUUID(), legacy.taskId, legacy.user, legacy.a1, legacy.a2]);
    await pool.query("INSERT INTO task_context_windows (id,task_id,context_node_id,branch_leaf_message_id,ordinal,opened_reason) VALUES ($1,$2,$3,$4,1,'initial')", [legacy.window, legacy.taskId, legacy.node, legacy.user]);
    await pool.query("INSERT INTO task_context_notes (task_id,context_node_id,path,revision,content) VALUES ($1,$2,'continuity.md',2,'Latest branch progress')", [legacy.taskId, legacy.node]);
    await pool.query("INSERT INTO task_context_history_items (task_id,window_id,context_node_id,ordinal,role,payload_json) VALUES ($1,$2,$3,1,'user','{\"role\":\"user\",\"content\":\"Retained legacy history\"}')", [legacy.taskId, legacy.window, legacy.node]);
    await pool.query(await readFile(new URL("../../../../../db/migrations/167_context_message_boundaries.sql", import.meta.url), "utf8"));
  });
  afterAll(async () => { await pool.query(`DROP SCHEMA ${schema} CASCADE`); await pool.end(); });

  it("upgrades the current legacy branch without exposing its state to older rewinds", async () => {
    const current = { taskId: legacy.taskId, ...await openContextWindow(legacy.taskId, legacy.a2) };
    expect((await loadContextNotesSummary(legacy.taskId, current.contextNodeId)).continuity).toBe("Latest branch progress");
    expect(await loadContextHistoryWindow(current, legacy.window)).toHaveLength(1);
    const replacement = await message(legacy.taskId, legacy.a1);
    const rewound = { taskId: legacy.taskId, ...await openContextWindow(legacy.taskId, replacement) };
    expect((await loadContextNotesSummary(legacy.taskId, rewound.contextNodeId)).continuity).toBeNull();
    expect(await loadContextHistoryWindow(rewound, legacy.window)).toEqual([]);
  });

  it("branches U1/A1/U2/A2 at A1 without abandoned instructions, approvals or later-created notes", async () => {
    const { taskId, user, state } = await fixture();
    await record(state, "user", "U1: draft a plan");
    const a1Item = await record(state, "assistant", "A1: first draft");
    await note(state, "Review pending");
    const a1 = await message(taskId, user);
    await linkVisibleContextNode(state, a1);
    const u2 = await message(taskId, a1);
    expect((await openContextWindow(taskId, u2)).windowId).toBe(state.windowId);
    await record(state, "user", "U2: abandoned instruction");
    await record(state, "assistant", "A2: abandoned reply");
    await note(state, "Approval: granted");
    await note(state, "Abandoned approval evidence", "later.md");
    const a2 = await message(taskId, u2);
    await linkVisibleContextNode(state, a2);

    const replacement = await message(taskId, a1);
    const store = createDbContextStore(taskId);
    const result = await resolveContextManagementState(store, { taskId, requestedVersion: "v2", runtimeModel: "test",
      branchLeafMessageId: replacement, seedItems: [{ role: "user", content: "Replacement U2: revise the plan" }] });
    if (result.state.version !== "v2") throw new Error("Expected V2");
    const branch = result.state;
    expect(branch.windowId).not.toBe(state.windowId);
    expect(JSON.stringify(result.conversationItems)).not.toContain("abandoned");
    expect(await loadContextNotesSummary(taskId, branch.contextNodeId)).toMatchObject({ continuity: "Review pending" });
    expect(await readContextNote(branch, { path: "later.md" })).toHaveProperty("error");
    expect(await listContextHistoryWindows(branch)).toContainEqual(expect.objectContaining({ windowId: state.windowId, lastItemId: a1Item, maxOrdinal: 2 }));
    expect((await loadContextHistoryWindow(branch, state.windowId)).map((item) => item.item)).toEqual([
      { role: "user", content: "U1: draft a plan" }, { role: "assistant", content: "A1: first draft" }
    ]);
    await note(branch, "Replacement branch draft");
    expect(await readContextNote(state, { path: "continuity.md" })).toMatchObject({ content: "Approval: granted" });
    expect(await loadContextHistoryWindow(state, branch.windowId)).toEqual([]);
    const otherReplacement = await message(taskId, a1);
    const other = { taskId, ...await openContextWindow(taskId, otherReplacement) };
    expect(await readContextNote(other, { path: "continuity.md" })).toMatchObject({ content: "Review pending" });
  });

  it("freezes a message even if its private window changes before the next visible message", async () => {
    const { taskId, user, state } = await fixture();
    await record(state, "user", "shared");
    await note(state, "original");
    const checkpoint = await message(taskId, user);
    await linkVisibleContextNode(state, checkpoint);
    for (let index = 0; index < 5; index += 1) await note(state, `private ${index}`);
    await record(state, "assistant", "private later history");
    const replacement = await message(taskId, checkpoint);
    const branch = { taskId, ...await openContextWindow(taskId, replacement) };
    expect(branch.windowId).not.toBe(state.windowId);
    expect(await readContextNote(branch, { path: "continuity.md" })).toMatchObject({ content: "original" });
    expect(await loadContextHistoryWindow(branch, state.windowId)).toHaveLength(1);
    const revisions = await pool.query("SELECT revision FROM task_context_notes WHERE context_node_id = $1 ORDER BY revision", [state.contextNodeId]);
    expect(revisions.rows.map((row) => row.revision)).toEqual([1, 6]);
    // Reconnecting at the current tool checkpoint still recovers its live tail.
    expect((await openContextWindow(taskId, checkpoint)).windowId).toBe(state.windowId);
  });

  it("rolls over through a frozen checkpoint even if an old writer later changes the ancestor", async () => {
    const { taskId, user, state } = await fixture();
    await record(state, "user", "before rollover");
    await note(state, "checkpoint state");
    const checkpoint = await message(taskId, user);
    const next = { taskId, ...await startNewContextWindowRecord(state, checkpoint, "automatic") };
    await note(state, "later abandoned state");
    await record(state, "assistant", "later abandoned history");
    expect(await readContextNote(next, { path: "continuity.md" })).toMatchObject({ content: "checkpoint state" });
    expect(await loadContextHistoryWindow(next, state.windowId)).toHaveLength(1);
  });

  it.each(["continuity.md", "notes/continuity.md"])("loads %s independently of the 50-file index", async (checkpointPath) => {
    const { taskId, state } = await fixture();
    await note(state, "Durable checkpoint", checkpointPath);
    await pool.query("UPDATE task_context_notes SET updated_at = '2020-01-01' WHERE context_node_id = $1", [state.contextNodeId]);
    for (let index = 0; index < 51; index += 1) await note(state, `note ${index}`, `new-${index}.md`);
    const summary = await loadContextNotesSummary(taskId, state.contextNodeId);
    expect(summary.continuity).toBe("Durable checkpoint");
    expect(summary.index).toHaveLength(50);
    expect(summary.index.some((entry) => entry.path === checkpointPath)).toBe(false);
  });

  it("searches effective contents before the file limit in both worker and executor tools", async () => {
    const { taskId, state } = await fixture();
    await note(state, "line one\nneedle %_ exact\nneedle %_ again", "matching.md");
    await pool.query("UPDATE task_context_notes SET updated_at = '2020-01-01' WHERE context_node_id = $1", [state.contextNodeId]);
    for (let index = 0; index < 125; index += 1) await note(state, "no match", `new-${index}.md`);
    const input = { query: "needle %_", recent_file_first: true, max_matches_per_file: 1 };
    const expected = { files: [{ path: "matching.md", matches: [{ line: 2, content: "needle %_ exact" }] }] };
    expect(await searchContextNotes(state, input)).toEqual(expected);
    expect(await searchExecutorNotes(createDbContextStore(taskId), state as never, { ...input, max_files: 100 })).toEqual(expected);
    await note(state, "no longer matches", "matching.md");
    expect(await searchContextNotes(state, input)).toEqual({ files: [] });
  });
});
