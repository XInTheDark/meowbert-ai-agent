import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RUN_API_PROTOCOL_VERSION, normalizeAgentSwarmSettings, type TaskExecutionJob } from "@meowbert/shared";

vi.mock("../../lib/db.js", async () => {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.TEST_LOCAL_SWARM_DATABASE_URL ?? "postgres://127.0.0.1:1/none", max: 4 });
  return {
    pool,
    query: (text: string, params: unknown[] = []) => pool.query(text, params),
    withTransaction: async <T>(fn: (client: import("pg").PoolClient) => Promise<T>): Promise<T> => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
  };
});
vi.mock("../../../../api/src/lib/db.js", async () => import("../../lib/db.js"));
vi.mock("../../../../api/src/lib/config.js", () => ({ config: { runApi: { url: "http://worker" } } }));
vi.mock("../../lib/queue.js", () => ({ taskQueue: { getJob: vi.fn(), add: vi.fn() } }));
vi.mock("../runtime/events.js", () => ({ emitTaskEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../lib/config.js", () => ({ config: { localExecution: { enabled: true } } }));
const { pool } = await import("../../lib/db.js");
const { claimLocalRun } = await import("../../../../api/src/services/devices/device-claims.js");
const { expireUnavailableLocalRunsOnce, reclaimExpiredLocalRunLeasesOnce } = await import("./local-run-recovery.js");
const { parkSwarmRun } = await import("../agent-swarm/park.js");

describe.skipIf(!process.env.TEST_LOCAL_SWARM_DATABASE_URL)("local swarm PostgreSQL lifecycle", () => {
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const environmentId = randomUUID();
  const deviceId = randomUUID();
  const executionTarget = { kind: "local" as const, deviceId, mode: "sandbox" as const };
  const capabilities = { dockerReady: true, sandboxImageReady: true, executorSupported: true, protocolVersion: RUN_API_PROTOCOL_VERSION, agentSwarm: true };

  beforeAll(async () => {
    await pool.query("INSERT INTO users(id,email,password_hash) VALUES ($1,$2,'test')", [userId, userId + "@test.invalid"]);
    await pool.query("INSERT INTO workspaces(id,name,slug,storage_backend_id) VALUES ($1,'Local swarm',$2,'backend')", [workspaceId, workspaceId]);
    await pool.query("INSERT INTO environments(id,workspace_id,name,root_path) VALUES ($1,$2,'Local swarm','/env')", [environmentId, workspaceId]);
    await pool.query(
      `INSERT INTO devices(id,user_id,name,platform,architecture,executor_version,verified_roots_json)
       VALUES ($1,$2,'Mac','darwin','arm64','1','{"backend":"/runtime"}')`, [deviceId, userId]
    );
  });
  beforeEach(async () => {
    await pool.query("UPDATE devices SET capabilities_json=$2,last_seen_at=now(),stream_expires_at=now()+interval '1 hour' WHERE id=$1", [deviceId, capabilities]);
  });
  afterEach(async () => {
    await pool.query("DELETE FROM task_swarms WHERE task_id IN (SELECT id FROM tasks WHERE workspace_id=$1)", [workspaceId]);
    await pool.query("DELETE FROM tasks WHERE workspace_id=$1", [workspaceId]);
  });
  afterAll(async () => {
    await pool.query("DELETE FROM workspaces WHERE id=$1", [workspaceId]);
    await pool.query("DELETE FROM users WHERE id=$1", [userId]);
    await pool.end();
  });

  async function createTask(swarm = true): Promise<string> {
    const taskId = randomUUID();
    await pool.query(
      `INSERT INTO tasks(id,workspace_id,environment_id,status,task_root_path,execution_target,workflow_type)
       VALUES ($1,$2,$3,'queued',$4,$5,$6)`,
      [taskId, workspaceId, environmentId, "tasks/" + taskId, executionTarget, swarm ? "agent_swarm" : null]
    );
    return taskId;
  }

  async function createRun(taskId: string, mode: TaskExecutionJob["mode"]): Promise<TaskExecutionJob> {
    const runId = randomUUID();
    await pool.query("INSERT INTO task_runs(id,task_id,attempt_no,run_kind) VALUES ($1,$2,1,$3)", [runId, taskId, mode]);
    const job = { taskId, runId, workspaceId, environmentId, triggerSource: "web" as const, mode, executionTarget };
    await pool.query(
      `INSERT INTO task_run_dispatches(run_id,task_id,workspace_id,environment_id,dispatch_class,queue_state,payload_json,admitted_at)
       VALUES ($1,$2,$3,$4,'interactive_new','admitted',$5,now())`,
      [runId, taskId, workspaceId, environmentId, job]
    );
    return job;
  }

  async function createParkedSwarm(withQueuedLane: boolean) {
    const rootId = await createTask();
    const settings = normalizeAgentSwarmSettings({ advanced: { maxRunningLanes: 1 } });
    await pool.query("INSERT INTO task_swarms(task_id,config_json) VALUES ($1,$2)", [rootId, settings]);
    const leaderJob = await createRun(rootId, "agent_swarm_leader");
    const laneIds: string[] = [];
    for (const status of withQueuedLane ? ["running", "queued"] : ["running"]) {
      const id = await createTask();
      await pool.query("UPDATE tasks SET workflow_parent_task_id=$2,workflow_internal_role='lane' WHERE id=$1", [id, rootId]);
      await pool.query(
        `INSERT INTO task_swarm_lanes(task_id,swarm_task_id,parent_task_id,depth,kind,title,status,weight)
         VALUES ($1,$2,$2,1,'split','Part',$3,1)`, [id, rootId, status]
      );
      laneIds.push(id);
    }
    const laneJob = await createRun(laneIds[0], "agent_swarm_lane");
    await parkSwarmRun({ job: leaderJob, swarmTaskId: rootId, maxRunningLanes: 1, reason: "lanes" });
    return { rootId, laneJob, queuedId: laneIds[1] };
  }

  it.each([
    ["agent_swarm_leader", true], ["agent_swarm_lane", true], ["default", true],
    ["compact_only", true], ["default", false], ["compact_only", false], ["scheduled_auto", false]
  ] as const)("rechecks swarm support at claim for mode=%s, swarm=%s", async (mode, swarm) => {
    const taskId = await createTask(swarm);
    const job = await createRun(taskId, mode);
    await pool.query("UPDATE devices SET capabilities_json=capabilities_json-'agentSwarm' WHERE id=$1", [deviceId]);
    const claimed = await claimLocalRun({ userId, deviceId, runId: job.runId });
    expect(claimed === null).toBe(swarm);
    if (swarm) {
      expect((await pool.query("SELECT queue_state,lease_device_id FROM task_run_dispatches WHERE run_id=$1", [job.runId])).rows[0])
        .toEqual({ queue_state: "admitted", lease_device_id: null });
      await pool.query("UPDATE devices SET capabilities_json=$2 WHERE id=$1", [deviceId, capabilities]);
      expect(await claimLocalRun({ userId, deviceId, runId: job.runId })).not.toBeNull();
    }
  });

  it.each([false, true])("settles an unavailable lane and advances the queue and parent, cancelled=%s", async (cancelled) => {
    const { rootId, laneJob, queuedId } = await createParkedSwarm(true);
    await pool.query("UPDATE tasks SET cancellation_requested=$2 WHERE id=$1", [laneJob.taskId, cancelled]);
    await pool.query("UPDATE task_run_dispatches SET queue_state='pending',eligible_at=now()-interval '25 hours' WHERE run_id=$1", [laneJob.runId]);
    expect(await expireUnavailableLocalRunsOnce()).toBe(1);
    const lane = (await pool.query("SELECT status,result_json,ended_at FROM task_swarm_lanes WHERE task_id=$1", [laneJob.taskId])).rows[0];
    expect(lane).toMatchObject({ status: cancelled ? "stopped" : "failed", ended_at: expect.any(Date), result_json: { files: [] } });
    expect(lane.result_json.summary).toContain(cancelled ? "Stopped" : "unavailable");
    expect((await pool.query("SELECT status FROM tasks WHERE id=$1", [laneJob.taskId])).rows[0].status).toBe(cancelled ? "cancelled" : "failed");
    expect((await pool.query("SELECT status FROM task_swarm_lanes WHERE task_id=$1", [queuedId])).rows[0].status).toBe("running");
    expect((await pool.query("SELECT 1 FROM task_runs WHERE task_id=$1 AND ended_at IS NULL", [rootId])).rowCount).toBe(0);
    await pool.query("UPDATE task_run_dispatches SET eligible_at=now()-interval '25 hours' WHERE task_id=$1", [queuedId]);
    expect(await expireUnavailableLocalRunsOnce()).toBe(1);
    expect((await pool.query("SELECT 1 FROM task_runs WHERE task_id=$1 AND ended_at IS NULL", [rootId])).rowCount).toBe(1);
    expect((await pool.query("SELECT 1 FROM task_swarm_parks WHERE task_id=$1", [rootId])).rowCount).toBe(0);
    expect(await expireUnavailableLocalRunsOnce()).toBe(0);
  });

  it.each(["cancelled", "trashed", "retry"])("reclaims a lane lease with outcome=%s", async (outcome) => {
    const { rootId, laneJob } = await createParkedSwarm(false);
    await pool.query(
      "UPDATE tasks SET status='running',cancellation_requested=$2,trashed_at=CASE WHEN $3 THEN now() ELSE NULL END WHERE id=$1",
      [laneJob.taskId, outcome === "cancelled", outcome === "trashed"]
    );
    await pool.query(
      "UPDATE task_run_dispatches SET queue_state='running',lease_device_id=$2,lease_epoch=4,lease_expires_at=now()-interval '2 minutes' WHERE run_id=$1",
      [laneJob.runId, deviceId]
    );
    expect(await reclaimExpiredLocalRunLeasesOnce()).toBe(1);
    const retry = outcome === "retry";
    expect((await pool.query("SELECT status FROM task_swarm_lanes WHERE task_id=$1", [laneJob.taskId])).rows[0].status).toBe(retry ? "running" : "stopped");
    expect((await pool.query("SELECT ended_at FROM task_runs WHERE id=$1", [laneJob.runId])).rows[0].ended_at === null).toBe(retry);
    expect((await pool.query("SELECT lease_epoch,lease_device_id,queue_state FROM task_run_dispatches WHERE run_id=$1", [laneJob.runId])).rows[0])
      .toEqual({ lease_epoch: 5, lease_device_id: null, queue_state: retry ? "pending" : "cancelled" });
    expect((await pool.query("SELECT 1 FROM task_runs WHERE task_id=$1 AND ended_at IS NULL", [rootId])).rowCount).toBe(retry ? 0 : 1);
  });

  it.each(["expiry", "cancelledLease"])("rolls back %s if the next lane cannot be dispatched", async (outcome) => {
    const { laneJob, queuedId } = await createParkedSwarm(true);
    const cancelled = outcome === "cancelledLease";
    await pool.query("UPDATE tasks SET cancellation_requested=$2 WHERE id=$1", [laneJob.taskId, cancelled]);
    await pool.query(
      `UPDATE task_run_dispatches SET queue_state=$2,eligible_at=now()-interval '25 hours',
         lease_expires_at=now()-interval '2 minutes' WHERE run_id=$1`,
      [laneJob.runId, cancelled ? "running" : "pending"]
    );
    const recover = cancelled ? reclaimExpiredLocalRunLeasesOnce : expireUnavailableLocalRunsOnce;
    await pool.query(`ALTER TABLE task_runs ADD CONSTRAINT reject_queued_test_lane CHECK (task_id <> '${queuedId}'::uuid)`);
    try {
      await expect(recover()).rejects.toThrow("reject_queued_test_lane");
      expect((await pool.query("SELECT ended_at FROM task_runs WHERE id=$1", [laneJob.runId])).rows[0].ended_at).toBeNull();
      expect((await pool.query("SELECT status FROM tasks WHERE id=$1", [laneJob.taskId])).rows[0].status).toBe("queued");
      expect((await pool.query("SELECT queue_state FROM task_run_dispatches WHERE run_id=$1", [laneJob.runId])).rows[0].queue_state)
        .toBe(cancelled ? "running" : "pending");
      expect((await pool.query("SELECT status FROM task_swarm_lanes WHERE task_id=$1", [laneJob.taskId])).rows[0].status).toBe("running");
    } finally {
      await pool.query("ALTER TABLE task_runs DROP CONSTRAINT reject_queued_test_lane");
    }
    expect(await recover()).toBe(1);
    expect((await pool.query("SELECT status FROM task_swarm_lanes WHERE task_id=$1", [queuedId])).rows[0].status).toBe("running");
  });

  it("settles a lane and wakes its parent once when recovery overlaps", async () => {
    const { rootId, laneJob } = await createParkedSwarm(false);
    await pool.query("UPDATE task_run_dispatches SET queue_state='pending',eligible_at=now()-interval '25 hours' WHERE run_id=$1", [laneJob.runId]);
    const recovered = await Promise.all([expireUnavailableLocalRunsOnce(), expireUnavailableLocalRunsOnce()]);
    expect(recovered.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect((await pool.query("SELECT 1 FROM task_runs WHERE task_id=$1 AND ended_at IS NULL", [rootId])).rowCount).toBe(1);
  });

  it("does not expire a superseded lane attempt", async () => {
    const { laneJob } = await createParkedSwarm(false);
    await pool.query("UPDATE task_run_dispatches SET queue_state='pending',eligible_at=now()-interval '25 hours' WHERE run_id=$1", [laneJob.runId]);
    await pool.query("INSERT INTO task_runs(id,task_id,attempt_no,run_kind) VALUES ($1,$2,2,'agent_swarm_lane')", [randomUUID(), laneJob.taskId]);
    expect(await expireUnavailableLocalRunsOnce()).toBe(0);
    expect((await pool.query("SELECT ended_at FROM task_runs WHERE id=$1", [laneJob.runId])).rows[0].ended_at).toBeNull();
    expect((await pool.query("SELECT status FROM task_swarm_lanes WHERE task_id=$1", [laneJob.taskId])).rows[0].status).toBe("running");
  });
});
