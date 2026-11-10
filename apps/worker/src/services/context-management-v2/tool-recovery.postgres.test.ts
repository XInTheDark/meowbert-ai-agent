import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ToolDispatchContext } from "@meowbert/run-executor/agent-tool-dispatch/types";
import type { ContextManagementV2State } from "@meowbert/run-executor/context-management-v2/types";

const databaseUrl = process.env.TEST_CONTEXT_DATABASE_URL;
const { schema } = vi.hoisted(() => ({ schema: `tool_recovery_${process.pid}_${Date.now()}` }));
vi.mock("../../lib/db.js", async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.TEST_CONTEXT_DATABASE_URL ?? "postgres://127.0.0.1:1/none",
    options: `-c search_path=${schema}`, max: 4 });
  return { pool, query: (sql: string, params: unknown[]) => pool.query(sql, params) };
});
vi.mock("../tasks/task-history-reader.js", () => ({ readTaskPayloads: async (_taskId: string, _kind: string, rows: unknown[]) => rows }));
const { pool } = await import("../../lib/db.js");
const { openContextWindow, linkVisibleContextNode, loadWindowItems } = await import("./service.js");
const { appendToolMessage } = await import("@meowbert/run-executor/agent-tool-dispatch/events");

describe.skipIf(!databaseUrl)("Tool message recovery in PostgreSQL", () => {
  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA ${schema}`);
    await pool.query("CREATE TABLE tasks (id uuid PRIMARY KEY); CREATE TABLE task_messages (id uuid PRIMARY KEY, task_id uuid REFERENCES tasks, parent_message_id uuid REFERENCES task_messages)");
    await pool.query(await readFile(new URL("../../../../../db/migrations/110_context_management_v2.sql", import.meta.url), "utf8"));
  });
  afterAll(async () => {
    await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  it("recovers the existing window from the last tool message, including nested exec calls", async () => {
    const taskId = randomUUID();
    const userId = randomUUID();
    await pool.query("INSERT INTO tasks VALUES ($1)", [taskId]);
    await pool.query("INSERT INTO task_messages VALUES ($1, $2, NULL)", [userId, taskId]);
    const opened = await openContextWindow(taskId, userId);
    const saved = { type: "function_call_output", call_id: "create-env", output: "Environment created successfully" };
    await pool.query("INSERT INTO task_context_history_items (task_id, window_id, context_node_id, ordinal, role, payload_json) VALUES ($1, $2, $3, 1, 'tool', $4::jsonb)",
      [taskId, opened.windowId, opened.contextNodeId, JSON.stringify(saved)]);
    const state = { version: "v2", taskId, ...opened } as ContextManagementV2State;
    let leaf = userId;
    const ctx = {
      contextManagementV2: state,
      getCurrentLeafMessageId: () => leaf,
      setCurrentLeafMessageId: (id: string) => { leaf = id; },
      control: {
        appendMessage: async ({ parentMessageId }: { parentMessageId: string }) => {
          const id = randomUUID();
          await pool.query("INSERT INTO task_messages VALUES ($1, $2, $3)", [id, taskId, parentMessageId]);
          return id;
        },
        context: { linkVisibleMessage: linkVisibleContextNode },
        selectBranch: async () => {}
      }
    } as unknown as ToolDispatchContext;
    await Promise.all(["host_shell", "exec"].map((tool) => appendToolMessage({ ...ctx, codeModeParentCallId: "outer-exec" }, { tool })));
    const recovered = await openContextWindow(taskId, leaf);
    expect(recovered.windowId).toBe(opened.windowId);
    expect(recovered.contextNodeId).toBe(opened.contextNodeId);
    expect(await loadWindowItems(taskId, recovered.windowId)).toEqual([saved]);
    expect((await pool.query("SELECT count(*)::int AS count FROM task_context_windows WHERE task_id = $1", [taskId])).rows[0].count).toBe(1);

    // A separate branch without an attachment must not acquire this private window.
    const siblingId = randomUUID();
    await pool.query("INSERT INTO task_messages VALUES ($1, $2, $3)", [siblingId, taskId, userId]);
    const sibling = await openContextWindow(taskId, siblingId);
    expect(sibling.windowId).not.toBe(opened.windowId);
    expect(await loadWindowItems(taskId, sibling.windowId)).toEqual([]);
  });
});
