import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.MEMORY_DELTA_TEST_DATABASE_URL,
    options: "-c search_path=memory_queue_test" });
  return { pool, query: (sql: string, params?: unknown[]) => pool.query(sql, params),
    withTransaction: async (action: (client: import("pg").PoolClient) => Promise<unknown>) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await action(client);
        await client.query("COMMIT");
        return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
  };
});
import { pool, query } from "../../lib/db.js";
import { claimNextMemorySynthesisRequest } from "./queue.js";

async function addWorkspace(kind = "server"): Promise<string> {
  const id = randomUUID();
  await query("INSERT INTO workspaces (id, file_host) VALUES ($1, $2::jsonb)", [id, JSON.stringify({ kind })]);
  return id;
}

async function addRequest(workspaceId: string, status = "queued"): Promise<string> {
  const id = randomUUID();
  await query("INSERT INTO memory_synthesis_requests (id, workspace_id, environment_id, status) VALUES ($1, $2, $3, $4)",
    [id, workspaceId, randomUUID(), status]);
  return id;
}

describe.skipIf(!process.env.MEMORY_DELTA_TEST_DATABASE_URL)("Memory refresh queue (PostgreSQL)", () => {
  beforeAll(async () => {
    await query("CREATE SCHEMA memory_queue_test");
    await query("CREATE TABLE workspaces (id uuid PRIMARY KEY, file_host jsonb NOT NULL)");
    await query(`CREATE TABLE memory_synthesis_requests (
      id uuid PRIMARY KEY, workspace_id uuid NOT NULL, environment_id uuid NOT NULL,
      initiator_user_id uuid, source_through_at timestamptz, status text NOT NULL,
      started_at timestamptz, updated_at timestamptz, created_at timestamptz DEFAULT now())`);
  });
  beforeEach(async () => { await query("TRUNCATE workspaces, memory_synthesis_requests"); });
  afterAll(async () => { await query("DROP SCHEMA memory_queue_test CASCADE"); await pool.end(); });

  it("starts only one sibling Project's refresh under concurrent claims", async () => {
    const workspaceId = await addWorkspace();
    for (let index = 0; index < 10; index += 1) await addRequest(workspaceId);
    const claims = await Promise.all(Array.from({ length: 10 }, () => claimNextMemorySynthesisRequest({ workspaceId })));
    expect(claims.filter(Boolean)).toHaveLength(1);
    const status = await query<{ status: string; count: string }>("SELECT status, count(*) FROM memory_synthesis_requests GROUP BY status");
    expect(Object.fromEntries(status.rows.map((row) => [row.status, Number(row.count)]))).toEqual({ queued: 9, running: 1 });
  });

  it("continues sibling Projects in order after successful or failed refreshes", async () => {
    const workspaceId = await addWorkspace();
    const ids = [await addRequest(workspaceId), await addRequest(workspaceId), await addRequest(workspaceId)];
    for (const id of ids) {
      const request = await claimNextMemorySynthesisRequest({ workspaceId });
      expect(request?.id).toBe(id);
      expect(await claimNextMemorySynthesisRequest({ workspaceId })).toBeNull();
      await query("UPDATE memory_synthesis_requests SET status = $2 WHERE id = $1", [id, id === ids[1] ? "failed" : "succeeded"]);
    }
    expect(await claimNextMemorySynthesisRequest({ workspaceId })).toBeNull();
  });

  it("lets other workspaces progress while one has a running refresh and skips device workspaces", async () => {
    const busy = await addWorkspace();
    await addRequest(busy, "running");
    await addRequest(busy);
    await addRequest(await addWorkspace("device"));
    const available = await addWorkspace();
    const expected = await addRequest(available);
    expect((await claimNextMemorySynthesisRequest())?.id).toBe(expected);
    expect(await claimNextMemorySynthesisRequest()).toBeNull();
  });

  it("skips a workspace locked by another worker without blocking unrelated work", async () => {
    const locked = await addWorkspace();
    await addRequest(locked);
    const available = await addWorkspace();
    const expected = await addRequest(available);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE", [locked]);
      expect((await claimNextMemorySynthesisRequest())?.id).toBe(expected);
    } finally { await client.query("ROLLBACK"); client.release(); }
    expect((await claimNextMemorySynthesisRequest())?.workspace_id).toBe(locked);
  });
});
