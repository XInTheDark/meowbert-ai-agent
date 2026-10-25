import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ query: vi.fn(), transaction: vi.fn() }));
vi.mock("../../lib/db.js", () => ({ query: db.query, withTransaction: db.transaction }));
import { finishWorkspaceRelinksOnce } from "./device-workspace-relinks.js";

const databaseUrl = process.env.TEST_LOCAL_WORKSPACE_DATABASE_URL;
describe.skipIf(!databaseUrl)("device workspace persistence", () => {
  const client = new Client({ connectionString: databaseUrl });
  const schema = "device_workspaces_" + randomUUID().replaceAll("-", "");
  const oldDevice = "11111111-1111-4111-8111-111111111111";
  const newDevice = "22222222-2222-4222-8222-222222222222";
  beforeAll(async () => {
    await client.connect();
    await client.query('CREATE SCHEMA "' + schema + '"');
    await client.query('SET search_path TO "' + schema + '", public');
    await client.query(
      "CREATE TABLE devices (id uuid PRIMARY KEY, revoked_at timestamptz);" +
      "CREATE TABLE workspaces (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), root_path text NOT NULL DEFAULT '', storage_backend_id text NOT NULL DEFAULT 'default', updated_at timestamptz DEFAULT now());" +
      "CREATE TABLE environments (id uuid PRIMARY KEY, workspace_id uuid REFERENCES workspaces ON DELETE CASCADE);" +
      "CREATE TABLE tasks (id uuid PRIMARY KEY, workspace_id uuid REFERENCES workspaces ON DELETE CASCADE, environment_id uuid REFERENCES environments ON DELETE CASCADE, execution_target jsonb NOT NULL DEFAULT '{\"kind\":\"cloud\"}', task_root_path text NOT NULL, status text DEFAULT 'running', cancellation_requested boolean DEFAULT false, trashed_at timestamptz, updated_at timestamptz DEFAULT now());" +
      "CREATE TABLE task_runs (id uuid PRIMARY KEY, task_id uuid REFERENCES tasks ON DELETE CASCADE, ended_at timestamptz);" +
      "CREATE TABLE task_run_dispatches (run_id uuid PRIMARY KEY REFERENCES task_runs ON DELETE CASCADE, task_id uuid REFERENCES tasks ON DELETE CASCADE, workspace_id uuid REFERENCES workspaces ON DELETE CASCADE, payload_json jsonb NOT NULL, queue_state text, admitted_at timestamptz, lease_device_id uuid, lease_holder text, lease_expires_at timestamptz, lease_api_url text, lease_epoch integer NOT NULL DEFAULT 1, started_at timestamptz, pending_reason text, storage_retry_at timestamptz, eligible_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());"
    );
    await client.query(await fs.readFile(new URL("../../../../../db/migrations/146_device_workspaces.sql", import.meta.url), "utf8"));
    db.query.mockImplementation((...args: Parameters<typeof client.query>) => client.query(...args));
    db.transaction.mockImplementation(async (run: (client: Client) => Promise<unknown>) => {
      await client.query("BEGIN");
      try { const result = await run(client); await client.query("COMMIT"); return result; }
      catch (error) { await client.query("ROLLBACK"); throw error; }
    });
  });
  beforeEach(async () => { await client.query("TRUNCATE workspaces, devices CASCADE"); });
  afterAll(async () => { await client.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE'); await client.end(); });

  async function fixture() {
    await client.query("INSERT INTO devices(id) VALUES ($1), ($2)", [oldDevice, newDevice]);
    const workspaceId = randomUUID(); const projectId = randomUUID(); const taskId = randomUUID(); const runId = randomUUID();
    await client.query("INSERT INTO workspaces(id, root_path, file_host) VALUES ($1, '/must-not-persist', $2)", [workspaceId, { kind: "device", deviceId: oldDevice }]);
    await client.query("INSERT INTO environments(id, workspace_id) VALUES ($1, $2)", [projectId, workspaceId]);
    await client.query("INSERT INTO tasks(id, workspace_id, environment_id, task_root_path) VALUES ($1, $2, $3, $4)", [taskId, workspaceId, projectId, ".meowbert/task-runs/" + taskId]);
    await client.query("INSERT INTO task_runs(id, task_id) VALUES ($1, $2)", [runId, taskId]);
    return { workspaceId, projectId, taskId, runId };
  }

  it("fixes the file host kind, clears device roots and forces tasks to the owning device", async () => {
    const { workspaceId, taskId } = await fixture();
    expect((await client.query("SELECT root_path FROM workspaces WHERE id = $1", [workspaceId])).rows[0].root_path).toBe("");
    expect((await client.query("SELECT execution_target FROM tasks WHERE id = $1", [taskId])).rows[0].execution_target).toEqual({ kind: "local", mode: "sandbox", deviceId: oldDevice });
    await expect(client.query("UPDATE workspaces SET file_host = '{\"kind\":\"server\"}' WHERE id = $1", [workspaceId])).rejects.toThrow("cannot change");
    await expect(client.query("UPDATE tasks SET execution_target = $2 WHERE id = $1", [taskId, { kind: "local", mode: "host", deviceId: newDevice }])).rejects.toThrow("cannot reach");
  });

  it("records durable archive tombstones and retains workspace deletion records after cascades", async () => {
    const { workspaceId, taskId } = await fixture();
    await client.query("UPDATE tasks SET trashed_at = now() WHERE id = $1", [taskId]);
    const pending = (await client.query("SELECT kind, not_before > now() AS delayed FROM device_file_tombstones ORDER BY kind")).rows;
    expect(pending).toEqual([{ kind: "scratch", delayed: true }, { kind: "task", delayed: true }]);
    await client.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    expect((await client.query("SELECT count(*)::int AS count FROM device_file_tombstones WHERE workspace_id = $1 AND kind = 'workspace'", [workspaceId])).rows[0].count).toBe(1);
  });

  it("waits out fencing before moving active runs and clears the old lease for recovery", async () => {
    const { workspaceId, taskId, runId } = await fixture();
    const target = { kind: "local", mode: "sandbox", deviceId: oldDevice };
    await client.query("INSERT INTO task_run_dispatches(run_id, task_id, workspace_id, payload_json, queue_state, lease_device_id, lease_holder, lease_api_url, lease_expires_at) VALUES ($1, $2, $3, $4, 'running', $5, 'device:old', 'http://old-worker', now())", [runId, taskId, workspaceId, { executionTarget: target }, oldDevice]);
    await client.query("INSERT INTO workspace_device_relinks(workspace_id, old_device_id, new_device_id) VALUES ($1, $2, $3)", [workspaceId, oldDevice, newDevice]);
    await finishWorkspaceRelinksOnce();
    expect((await client.query("SELECT file_host FROM workspaces WHERE id = $1", [workspaceId])).rows[0].file_host.deviceId).toBe(oldDevice);
    await client.query("UPDATE workspace_device_relinks SET eligible_at = now() - interval '1 second'");
    await finishWorkspaceRelinksOnce();
    const dispatch = (await client.query("SELECT * FROM task_run_dispatches WHERE run_id = $1", [runId])).rows[0];
    expect(dispatch).toMatchObject({ queue_state: "pending", lease_holder: null, lease_device_id: null, lease_api_url: null, lease_epoch: 2, payload_json: { executionTarget: { deviceId: newDevice } } });
    expect((await client.query("SELECT status, execution_target FROM tasks WHERE id = $1", [taskId])).rows[0]).toMatchObject({ status: "queued", execution_target: { deviceId: newDevice } });
  });
});
