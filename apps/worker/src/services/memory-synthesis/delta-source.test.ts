import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Opt-in integration test; point MEMORY_DELTA_TEST_DATABASE_URL at a disposable PostgreSQL database.
vi.mock("../../lib/db.js", async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.MEMORY_DELTA_TEST_DATABASE_URL,
    options: "-c search_path=memory_delta_test" });
  return { pool, query: (sql: string, params?: unknown[]) => pool.query(sql, params) };
});
import { pool, query } from "../../lib/db.js";
import { loadDelta } from "./delta-source.js";

const environmentId = randomUUID();

async function addTask(title: string, options: { incognito?: boolean; parentId?: string } = {}): Promise<string> {
  const id = randomUUID();
  await query(
    "INSERT INTO tasks (id, environment_id, title, is_incognito, parent_task_id) VALUES ($1, $2, $3, $4, $5)",
    [id, environmentId, title, options.incognito === true, options.parentId ?? null]
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
      is_incognito boolean NOT NULL DEFAULT false, parent_task_id uuid, workflow_parent_task_id uuid)`);
    await query(`CREATE TABLE task_messages (
      id bigserial PRIMARY KEY, task_id uuid NOT NULL, role text NOT NULL,
      content_json jsonb NOT NULL, created_at timestamptz NOT NULL)`);
    await query("CREATE TABLE memory_synthesis_requests (id uuid PRIMARY KEY, task_id uuid)");
  });
  afterAll(async () => { await query("DROP SCHEMA memory_delta_test CASCADE"); await pool.end(); });

  it("leaves incognito tasks, their descendants and refresh tasks out of the delta", async () => {
    await addTask("Planning");
    const incognito = await addTask("Temporary review", { incognito: true });
    const subtask = await addTask("Temporary subtask", { parentId: incognito });
    await addTask("Temporary sub-subtask", { parentId: subtask });
    const refresh = await addTask("Refresh memory");
    await query("INSERT INTO memory_synthesis_requests (id, task_id) VALUES ($1, $2)", [randomUUID(), refresh]);

    const delta = await loadDelta({ environmentId, sourceAfter: null });

    expect(delta.map((message) => message.task_title)).toEqual(["Planning"]);
  });
});
