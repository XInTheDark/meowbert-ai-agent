import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const databaseUrl = process.env.TEST_CONTEXT_DATABASE_URL;
const { schema } = vi.hoisted(() => ({ schema: `window_prompt_${process.pid}_${Date.now()}` }));
vi.mock("../../lib/db.js", async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.TEST_CONTEXT_DATABASE_URL ?? "postgres://127.0.0.1:1/none",
    options: `-c search_path=${schema}`, max: 4 });
  return { pool, query: (sql: string, params: unknown[]) => pool.query(sql, params) };
});

const { pool } = await import("../../lib/db.js");
const { freezeContextWindowPrompt } = await import("./window-prompt.js");

describe.skipIf(!databaseUrl)("Window prompt snapshots in PostgreSQL", () => {
  const taskId = randomUUID();
  const window = { taskId, windowId: randomUUID(), contextNodeId: randomUUID() };
  const initial = [{ role: "developer" as const, content: "Original notes" }];
  const updated = [{ role: "developer" as const, content: "Updated notes" }];

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query("CREATE TABLE tasks (id uuid PRIMARY KEY); CREATE TABLE task_messages (id uuid PRIMARY KEY)");
    await pool.query(await readFile(new URL("../../../../../db/migrations/110_context_management_v2.sql", import.meta.url), "utf8"));
    await pool.query(await readFile(new URL("../../../../../db/migrations/154_context_window_prompt.sql", import.meta.url), "utf8"));
    await pool.query("INSERT INTO tasks (id) VALUES ($1)", [taskId]);
    await pool.query("INSERT INTO task_context_nodes (id, task_id, kind) VALUES ($1, $2, 'private')", [window.contextNodeId, taskId]);
    await pool.query("INSERT INTO task_context_windows (id, task_id, context_node_id, ordinal, opened_reason) VALUES ($1, $2, $3, 1, 'initial')",
      [window.windowId, taskId, window.contextNodeId]);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  it("keeps the first snapshot after writes, reconnects and branch-node changes", async () => {
    expect(await freezeContextWindowPrompt(window, initial)).toEqual(initial);
    expect(await freezeContextWindowPrompt({ ...window, contextNodeId: randomUUID() }, updated)).toEqual(initial);
    const client = await pool.connect();
    try {
      const result = await client.query("SELECT opening_prompt_json FROM task_context_windows WHERE id = $1", [window.windowId]);
      expect(result.rows[0].opening_prompt_json).toEqual(initial);
    } finally { client.release(); }
  });

  it("chooses one snapshot atomically and keeps a new window independent", async () => {
    const next = { ...window, windowId: randomUUID() };
    await pool.query("INSERT INTO task_context_windows (id, task_id, context_node_id, ordinal, opened_reason) VALUES ($1, $2, $3, 2, 'idle')",
      [next.windowId, taskId, next.contextNodeId]);
    const results = await Promise.all([freezeContextWindowPrompt(next, updated), freezeContextWindowPrompt(next, initial)]);
    expect(results[0]).toEqual(results[1]);
    expect([initial, updated]).toContainEqual(results[0]);
    expect(await freezeContextWindowPrompt(window, updated)).toEqual(initial);
  });

  it("refuses another task and enforces the migration's array constraint", async () => {
    await expect(freezeContextWindowPrompt({ ...window, taskId: randomUUID() }, updated)).rejects.toThrow("does not belong");
    await expect(pool.query("UPDATE task_context_windows SET opening_prompt_json = '{}'::jsonb WHERE id = $1", [window.windowId]))
      .rejects.toMatchObject({ code: "23514" });
  });
});
