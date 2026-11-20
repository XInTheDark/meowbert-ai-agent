import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({ withTransaction: vi.fn(), query: vi.fn() }));
vi.mock("../run-host/run-cancellation.js", () => ({ handleCancelledRun: vi.fn() }));
vi.mock("../agent-swarm/run-finalize.js", () => ({ finishFailedLaneRun: vi.fn() }));
import { query, withTransaction } from "../../lib/db.js";
import { handleCancelledRun } from "../run-host/run-cancellation.js";
import { settleUnclaimedRunInterruptionsOnce } from "./unclaimed-run-interruptions.js";
import { reclaimExpiredLocalRunLeasesOnce } from "./local-run-recovery.js";

const databaseUrl = process.env.TEST_PROJECT_MASTER_DATABASE_URL;
describe.skipIf(!databaseUrl)("unclaimed run interruptions in PostgreSQL", () => {
  const client = new Client({ connectionString: databaseUrl });
  const schema = `unclaimed_interrupt_test_${randomUUID().replaceAll("-", "")}`;

  async function dispatch(input: { local?: boolean; state?: string; lease?: boolean; interrupted?: boolean; newer?: boolean; closed?: boolean } = {}) {
    const taskId = randomUUID();
    const runId = randomUUID();
    const payload = { taskId, runId, executionTarget: input.local ? { kind: "local", deviceId: randomUUID(), mode: "sandbox" } : { kind: "cloud" } };
    await client.query("INSERT INTO tasks VALUES ($1, $2)", [taskId, input.interrupted !== false]);
    await client.query("INSERT INTO task_runs VALUES ($1, $2, 1, $3)", [runId, taskId, input.closed ? new Date() : null]);
    if (input.newer) await client.query("INSERT INTO task_runs VALUES ($1, $2, 2, NULL)", [randomUUID(), taskId]);
    await client.query(`INSERT INTO task_run_dispatches(run_id, task_id, queue_state, payload_json, lease_device_id)
      VALUES ($1, $2, $3, $4, $5)`, [runId, taskId, input.state ?? "pending", payload, input.lease ? randomUUID() : null]);
    return payload;
  }

  beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}";
      CREATE TABLE tasks(id uuid PRIMARY KEY, cancellation_requested boolean, resume_after_interrupt boolean DEFAULT true,
        status text DEFAULT 'queued', trashed_at timestamptz, completed_at timestamptz, updated_at timestamptz);
      CREATE TABLE task_runs(id uuid PRIMARY KEY, task_id uuid, attempt_no integer, ended_at timestamptz, exit_reason text);
      CREATE TABLE task_run_dispatches(run_id uuid PRIMARY KEY, task_id uuid, queue_state text, payload_json jsonb,
        lease_device_id uuid, lease_epoch integer DEFAULT 0, lease_holder text, lease_api_url text,
        lease_expires_at timestamptz, finished_at timestamptz, updated_at timestamptz,
        admitted_at timestamptz, started_at timestamptz, eligible_at timestamptz DEFAULT now(), pending_reason text);
      CREATE TABLE task_swarm_lanes(task_id uuid, swarm_task_id uuid, parent_task_id uuid);`);
    vi.mocked(query).mockImplementation((sql, params) => client.query(sql, params) as never);
    vi.mocked(withTransaction).mockImplementation(async (run) => {
      await client.query("BEGIN");
      try { const result = await run(client as never); await client.query("COMMIT"); return result; }
      catch (error) { await client.query("ROLLBACK"); throw error; }
    });
  });
  beforeEach(async () => {
    vi.mocked(handleCancelledRun).mockClear();
    await client.query("TRUNCATE task_run_dispatches, task_runs, tasks");
  });
  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("settles pending cloud runs and unclaimed device runs while preserving active leases and current work", async () => {
    const cloud = await dispatch();
    const local = await dispatch({ local: true, state: "admitted" });
    await dispatch({ local: true, state: "admitted", lease: true });
    await dispatch({ local: true, state: "running", lease: true });
    await dispatch({ state: "admitted" });
    await dispatch({ newer: true });
    await dispatch({ closed: true });
    await dispatch({ interrupted: false });
    expect(await settleUnclaimedRunInterruptionsOnce()).toBe(2);
    expect(vi.mocked(handleCancelledRun).mock.calls.map(([job]) => job.runId).sort()).toEqual([cloud.runId, local.runId].sort());
    const rows = (await client.query("SELECT run_id, queue_state, lease_epoch FROM task_run_dispatches WHERE run_id = ANY($1::uuid[])", [[cloud.runId, local.runId]])).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.queue_state === "cancelled" && row.lease_epoch === 1)).toBe(true);
  });

  it("can recover a revoked dispatch when the worker exited before acknowledging the interruption", async () => {
    const interrupted = await dispatch({ state: "cancelled" });
    expect(await settleUnclaimedRunInterruptionsOnce()).toBe(1);
    expect(handleCancelledRun).toHaveBeenCalledWith(interrupted);
  });

  it("reclaims an expired device lease without turning an interrupted follow-up into a permanent cancellation", async () => {
    const interrupted = await dispatch({ local: true, state: "running", lease: true });
    await client.query("UPDATE task_run_dispatches SET lease_expires_at = now() - interval '2 minutes' WHERE run_id = $1", [interrupted.runId]);
    await expect(reclaimExpiredLocalRunLeasesOnce()).resolves.toBe(2);
    expect(handleCancelledRun).toHaveBeenCalledWith(interrupted);
    const task = (await client.query("SELECT status, resume_after_interrupt FROM tasks WHERE id = $1", [interrupted.taskId])).rows[0];
    expect(task).toEqual({ status: "queued", resume_after_interrupt: true });
    const run = (await client.query("SELECT ended_at FROM task_runs WHERE id = $1", [interrupted.runId])).rows[0];
    expect(run.ended_at).toBeNull();
  });
});
