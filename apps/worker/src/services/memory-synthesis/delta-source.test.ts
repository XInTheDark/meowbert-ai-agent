import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Opt-in integration test; point MEMORY_DELTA_TEST_DATABASE_URL at a disposable PostgreSQL database.
vi.mock("../../lib/db.js", async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.MEMORY_DELTA_TEST_DATABASE_URL,
    options: "-c search_path=memory_delta_test" });
  return { pool, query: (sql: string, params?: unknown[]) => pool.query(sql, params) };
});
vi.mock("../tasks/task-history-reader.js", () => ({ readTaskPayloads: async (_taskId: string, _kind: string, rows: object[]) => rows }));
import { pool, query } from "../../lib/db.js";
import { loadDelta } from "./delta-source.js";
import { readTaskEvidence } from "./evidence.js";

const environmentId = randomUUID();

async function addTask(title: string, options: { incognito?: boolean; parentId?: string; environmentId?: string } = {}): Promise<string> {
  const id = randomUUID();
  await query(
    "INSERT INTO tasks (id, environment_id, title, is_incognito, parent_task_id) VALUES ($1, $2, $3, $4, $5)",
    [id, options.environmentId ?? environmentId, title, options.incognito === true, options.parentId ?? null]
  );
  await query(
    "INSERT INTO task_messages (task_id, role, content_json, created_at) VALUES ($1, 'user', $2::jsonb, now())",
    [id, JSON.stringify({ text: `${title} message` })]
  );
  return id;
}

describe.skipIf(!process.env.MEMORY_DELTA_TEST_DATABASE_URL)("memory delta source (PostgreSQL)", () => {
  beforeAll(async () => {
    await query("CREATE SCHEMA memory_delta_test");
    await query(`CREATE TABLE tasks (
      id uuid PRIMARY KEY, environment_id uuid NOT NULL, title text,
      is_incognito boolean NOT NULL DEFAULT false, parent_task_id uuid, workflow_parent_task_id uuid, trashed_at timestamptz)`);
    await query(`CREATE TABLE task_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL, role text NOT NULL, parent_message_id uuid,
      content_json jsonb NOT NULL, created_at timestamptz NOT NULL)`);
    await query("CREATE TABLE memory_synthesis_requests (id uuid PRIMARY KEY, task_id uuid)");
  });
  beforeEach(async () => { await query("TRUNCATE tasks, task_messages, memory_synthesis_requests"); });
  afterAll(async () => { await query("DROP SCHEMA memory_delta_test CASCADE"); await pool.end(); });

  it("leaves incognito tasks, their descendants and refresh tasks out of the delta", async () => {
    const planning = await addTask("Planning");
    const incognito = await addTask("Temporary review", { incognito: true });
    const subtask = await addTask("Temporary subtask", { parentId: incognito });
    await addTask("Temporary sub-subtask", { parentId: subtask });
    const refresh = await addTask("Refresh memory");
    await query("INSERT INTO memory_synthesis_requests (id, task_id) VALUES ($1, $2)", [randomUUID(), refresh]);

    const delta = await loadDelta({ environmentId, sourceAfter: null });

    expect(delta.map((message) => message.task_title)).toEqual(["Planning"]);
    expect(delta[0].task_id).toBe(planning);
    const original = await readTaskEvidence({ task_id: planning, message_id: delta[0].message_id, before_message_id: null, offset_chars: null }, environmentId);
    expect(original.items).toEqual([expect.objectContaining({ message_id: delta[0].message_id, content: "Planning message", role: "user" })]);
  });

  it("denies evidence from other projects, incognito descendants and refresh descendants", async () => {
    const foreign = await addTask("Foreign", { environmentId: randomUUID() });
    const incognito = await addTask("Private", { incognito: true });
    const descendant = await addTask("Private child", { parentId: incognito });
    const refresh = await addTask("Refresh memory");
    await query("INSERT INTO memory_synthesis_requests (id, task_id) VALUES ($1, $2)", [randomUUID(), refresh]);
    const refreshChild = await addTask("Refresh child", { parentId: refresh });
    for (const taskId of [foreign, incognito, descendant, refresh, refreshChild]) {
      await expect(readTaskEvidence({ task_id: taskId, message_id: null, before_message_id: null, offset_chars: null }, environmentId)).rejects.toThrow("not accessible");
    }
  });

  it("paginates tool evidence without loss when timestamps tie and validates source ownership", async () => {
    const task = await addTask("Tests");
    const timestamp = "2026-11-08T00:00:00.000Z";
    const toolIds: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const id = randomUUID();
      toolIds.push(id);
      await query("INSERT INTO task_messages (id, task_id, role, content_json, created_at) VALUES ($1, $2, 'tool', $3::jsonb, $4)",
        [id, task, JSON.stringify({ tool: "run_shell", response_function_output: { output: `result ${index}` } }), timestamp]);
    }
    const found: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await readTaskEvidence({ task_id: task, message_id: null, before_message_id: cursor, offset_chars: null }, environmentId);
      found.push(...page.items.filter((item) => item.role === "tool").map((item) => item.message_id));
      cursor = page.next_before_message_id;
    } while (cursor);
    expect(found.sort()).toEqual(toolIds.sort());
    const other = await addTask("Other");
    await expect(readTaskEvidence({ task_id: other, message_id: toolIds[0], before_message_id: null, offset_chars: null }, environmentId)).rejects.toThrow("not found in this task");
  });
});
