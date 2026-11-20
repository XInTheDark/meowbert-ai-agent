import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "", pool: null as Pool | null, onLock: null as (() => void) | null }));
vi.mock("../../lib/config.js", () => ({ config: { runtime: { get taskScratch() { return { root: state.root }; } } } }));
vi.mock("../../lib/db.js", () => ({
  query: (sql: string, params?: unknown[]) => state.pool!.query(sql, params),
  withTransaction: async (fn: (client: PoolClient) => Promise<unknown>) => {
    const client = await state.pool!.connect();
    try {
      await client.query("BEGIN");
      const proxy = new Proxy(client, { get(target, key) {
        if (key === "query") return (sql: string, params?: unknown[]) => {
          const result = target.query(sql, params);
          if (sql === "SELECT id FROM tasks WHERE id = $1 FOR UPDATE") state.onLock?.();
          return result;
        };
        return Reflect.get(target, key);
      } });
      const result = await fn(proxy);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}));

import { detachIdleScratch, drainScratchTrash, listIdleScratchTasks } from "./scratch-eviction-store.js";
import { ensureTaskScratchDir } from "../tasks/task-scratch.js";

// Run with an isolated PostgreSQL database; no production or configured application DB is used.
const url = process.env.SCRATCH_TEST_DATABASE_URL;
const schema = `scratch_test_${randomUUID().replaceAll("-", "")}`;
const workspaceId = randomUUID();
const cutoff = new Date(Date.now() - 3_600_000).toISOString();
let admin: Pool;

describe.skipIf(!url)("scratch eviction database and filesystem", () => {
  beforeAll(async () => {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA ${schema}`);
    state.pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
    await state.pool.query(`
      CREATE TABLE platform_settings (id integer PRIMARY KEY);
      CREATE TABLE tasks (id uuid PRIMARY KEY, workspace_id uuid, status text, updated_at timestamptz);
      CREATE TABLE task_runs (id uuid DEFAULT gen_random_uuid(), task_id uuid, ended_at timestamptz);
      CREATE TABLE persistent_shell_sessions (created_by_task_id uuid, status text);
      CREATE TABLE task_swarm_lanes (task_id uuid, swarm_task_id uuid, status text);
    `);
    await state.pool.query(await fs.readFile(new URL("../../../../../db/migrations/166_scratch_storage.sql", import.meta.url), "utf8"));
  });
  beforeEach(async () => {
    if (state.root) await fs.rm(state.root, { recursive: true, force: true });
    state.root = await fs.mkdtemp(path.join(os.tmpdir(), "scratch-eviction-"));
    state.onLock = null;
    await state.pool!.query("TRUNCATE tasks, task_runs, persistent_shell_sessions, task_swarm_lanes");
  });
  afterAll(async () => {
    await state.pool?.end();
    await admin?.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin?.end();
    if (state.root) await fs.rm(state.root, { recursive: true, force: true });
  });

  async function task(status = "succeeded", recent = false) {
    const id = randomUUID();
    await state.pool!.query("INSERT INTO tasks(id, workspace_id, status, updated_at) VALUES ($1,$2,$3,now() - $4::interval)", [id, workspaceId, status, recent ? "5 minutes" : "2 days"]);
    return id;
  }

  it("excludes queued/running tasks, open runs, persistent shells, active swarms and recently ended runs", async () => {
    const safe = await task();
    for (const status of ["queued", "starting", "running"]) await task(status);
    await task("succeeded", true);
    const open = await task();
    await state.pool!.query("INSERT INTO task_runs(task_id) VALUES ($1)", [open]);
    const recentlyEnded = await task();
    await state.pool!.query("INSERT INTO task_runs(task_id, ended_at) VALUES ($1,now())", [recentlyEnded]);
    for (const status of ["starting", "running", "idle"]) {
      await state.pool!.query("INSERT INTO persistent_shell_sessions VALUES ($1,$2)", [await task(), status]);
    }
    const parked = await task("awaiting_input");
    await state.pool!.query("INSERT INTO task_swarm_lanes VALUES ($1,$2,'waiting')", [await task(), parked]);
    const client = await state.pool!.connect();
    try { expect((await listIdleScratchTasks(client, cutoff)).map((row) => row.id)).toEqual([safe]); }
    finally { client.release(); }
  });

  it("frees finished lanes of an open swarm but keeps its active lanes and the swarm itself", async () => {
    const root = await task("queued");
    const finished = [];
    for (const status of ["done", "failed", "stopped", "expired"]) {
      const lane = await task();
      await state.pool!.query("INSERT INTO task_swarm_lanes VALUES ($1,$2,$3)", [lane, root, status]);
      finished.push(lane);
    }
    for (const status of ["queued", "running", "waiting"]) {
      await state.pool!.query("INSERT INTO task_swarm_lanes VALUES ($1,$2,$3)", [await task(), root, status]);
    }
    const laggingLane = await task();
    await state.pool!.query("INSERT INTO task_swarm_lanes VALUES ($1,$2,'done')", [laggingLane, root]);
    await state.pool!.query("INSERT INTO task_runs(task_id) VALUES ($1)", [laggingLane]);
    const closedRoot = await task("awaiting_input");
    await state.pool!.query("INSERT INTO task_swarm_lanes VALUES ($1,$2,'done')", [await task(), closedRoot]);
    const client = await state.pool!.connect();
    try {
      const ids = (await listIdleScratchTasks(client, cutoff)).map((row) => row.id);
      expect(ids).toEqual(expect.arrayContaining(finished));
      expect(ids).not.toContain(root);
      expect(ids).not.toContain(laggingLane);
      expect(ids).toHaveLength(finished.length + 2);
    } finally { client.release(); }
  });

  it("clears only scratch, keeps history, and recreates an evicted directory on its next run", async () => {
    const id = await task();
    const scratch = path.join(state.root, workspaceId, id);
    const history = path.join(state.root, ".history", workspaceId, id);
    await fs.mkdir(scratch, { recursive: true });
    await fs.writeFile(path.join(scratch, "build"), "disposable");
    await fs.mkdir(history, { recursive: true });
    await fs.writeFile(path.join(history, "context"), "keep");
    const trash = await detachIdleScratch({ id, workspaceId, idleSince: 0, sizeBytes: null }, cutoff);
    expect(trash).not.toBeNull();
    await expect(fs.access(scratch)).rejects.toThrow();
    expect(await fs.readFile(path.join(history, "context"), "utf8")).toBe("keep");
    expect((await state.pool!.query("SELECT scratch_present, scratch_evicted_at FROM tasks WHERE id=$1", [id])).rows[0]).toMatchObject({ scratch_present: false, scratch_evicted_at: expect.any(Date) });
    await drainScratchTrash(state.root);
    expect(await fs.readdir(path.join(state.root, ".trash"))).toEqual([]);
    expect(await ensureTaskScratchDir({ taskId: id, workspaceId })).toBe(scratch);
    expect(await fs.readdir(scratch)).toEqual([]);
    expect((await state.pool!.query("SELECT scratch_present FROM tasks WHERE id=$1", [id])).rows[0].scratch_present).toBe(true);
  });

  it("leaves scratch intact when a new run queues while eviction is waiting for the task lock", async () => {
    const id = await task();
    const scratch = path.join(state.root, workspaceId, id);
    await fs.mkdir(scratch, { recursive: true });
    await fs.writeFile(path.join(scratch, "build"), "keep");
    const run = await state.pool!.connect();
    await run.query("BEGIN");
    await run.query("SELECT id FROM tasks WHERE id=$1 FOR UPDATE", [id]);
    let queued!: () => void;
    const waiting = new Promise<void>((resolve) => { queued = resolve; });
    state.onLock = queued;
    const eviction = detachIdleScratch({ id, workspaceId, idleSince: 0, sizeBytes: null }, cutoff);
    await waiting;
    await run.query("UPDATE tasks SET status='queued' WHERE id=$1", [id]);
    await run.query("COMMIT");
    run.release();
    expect(await eviction).toBeNull();
    expect(await fs.readFile(path.join(scratch, "build"), "utf8")).toBe("keep");
  });
});
