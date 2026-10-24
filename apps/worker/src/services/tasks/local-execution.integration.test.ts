import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", async () => (await import("./local-execution.test-fixtures.js")).database);
vi.mock("../../../../api/src/lib/db.js", async () => (await import("./local-execution.test-fixtures.js")).database);
vi.mock("../../../../api/src/lib/config.js", () => ({ config: { runApi: { url: "http://worker" } } }));
vi.mock("../../lib/queue.js", () => ({ taskQueue: { getJob: vi.fn(), add: vi.fn() } }));
vi.mock("../runtime/events.js", () => ({ emitTaskEvent: vi.fn() }));
vi.mock("../agent-db/index.js", () => ({ resolveContinuationBranchMessageId: vi.fn(), resolveLatestBranchSelectionUserId: vi.fn() }));
vi.mock("../runtime/debug-task-events.js", () => ({ createTaskDebugLogger: vi.fn() }));
vi.mock("../../lib/config.js", () => ({ config: { localExecution: { enabled: true } } }));
const { pool } = await import("./local-execution.test-fixtures.js");
const { claimLocalRun } = await import("../../../../api/src/services/devices/device-claims.js");
const { expireUnavailableLocalRunsOnce, reclaimExpiredLocalRunLeasesOnce, recoverQueuedTaskRunsOnce } = await import("./task-run-recovery.js");
const { sqlRunApiStores } = await import("../run-api/sql-stores.js");
const { taskQueue } = await import("../../lib/queue.js");

describe.skipIf(!process.env.TEST_LOCAL_EXECUTION_DATABASE_URL)("local execution PostgreSQL lifecycle", () => {
  const userId = randomUUID(); const workspaceId = randomUUID(); const projectId = randomUUID(); const deviceId = randomUUID();
  const target = { kind: "local", deviceId, mode: "sandbox" };
  beforeAll(async () => {
    await pool.query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'test')", [userId, userId + "@test.invalid"]);
    await pool.query("INSERT INTO workspaces (id, name, slug, storage_backend_id) VALUES ($1, 'Local', $2, 'backend')", [workspaceId, workspaceId]);
    await pool.query("INSERT INTO environments (id, workspace_id, name, root_path) VALUES ($1, $2, 'Local', '/runtime/project')", [projectId, workspaceId]);
    await pool.query(
      "INSERT INTO devices (id,user_id,name,platform,architecture,executor_version,capabilities_json,verified_roots_json,last_seen_at,stream_expires_at) VALUES ($1,$2,'Mac','darwin','arm64','1',$3,'{\"backend\":\"/runtime\"}',now(),now()+interval '1 hour')",
      [deviceId, userId, JSON.stringify({ dockerReady: true, sandboxImageReady: true, executorSupported: true, protocolVersion: 1 })]
    );
  });
  afterAll(async () => {
    await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    await pool.query("DELETE FROM users WHERE id = $1", [userId]); await pool.end();
  });
  async function createRun() {
    const taskId = randomUUID(); const runId = randomUUID();
    await pool.query("INSERT INTO tasks(id,workspace_id,environment_id,status,task_root_path,execution_target) VALUES ($1,$2,$3,'queued',$4,$5)", [taskId,workspaceId,projectId,".meowbert/task-runs/"+taskId,target]);
    await pool.query("INSERT INTO task_runs(id,task_id,attempt_no,run_kind) VALUES ($1,$2,1,'default')", [runId,taskId]);
    const job = { taskId,runId,workspaceId,environmentId:projectId,triggerSource:"web",executionTarget:target };
    await pool.query("INSERT INTO task_run_dispatches(run_id,task_id,workspace_id,environment_id,dispatch_class,queue_state,payload_json,admitted_at) VALUES ($1,$2,$3,$4,'interactive_new','admitted',$5,now())", [runId,taskId,workspaceId,projectId,job]);
    return { taskId,runId };
  }
  it("lets exactly one duplicate device claim and one lease claim win", async () => {
    const { runId } = await createRun();
    const claims = await Promise.all([claimLocalRun({ userId,deviceId,runId }),claimLocalRun({ userId,deviceId,runId })]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const leases = await Promise.all([1,2].map(() => sqlRunApiStores.leases.claim({ runId,holder:"device:"+deviceId,apiUrl:"http://worker",ttlMs:60_000 })));
    expect(leases.filter(Boolean)).toHaveLength(1);
    await pool.query("UPDATE task_run_dispatches SET queue_state='finished' WHERE run_id=$1",[runId]);
  });
  it.each([false,true])("reclaims an expired running lease and preserves cancellation=%s", async (cancelled) => {
    const { taskId,runId } = await createRun();
    await pool.query("UPDATE tasks SET status='running',cancellation_requested=$2 WHERE id=$1",[taskId,cancelled]);
    await pool.query("UPDATE task_run_dispatches SET queue_state='running',lease_device_id=$2,lease_epoch=4,lease_expires_at=now()-interval '2 minutes' WHERE run_id=$1",[runId,deviceId]);
    await reclaimExpiredLocalRunLeasesOnce();
    const task = (await pool.query("SELECT status,cancellation_requested FROM tasks WHERE id=$1",[taskId])).rows[0];
    const dispatch = (await pool.query("SELECT queue_state,lease_epoch,lease_device_id FROM task_run_dispatches WHERE run_id=$1",[runId])).rows[0];
    expect(task).toMatchObject({status:cancelled?"cancelled":"queued",cancellation_requested:cancelled});
    expect(dispatch).toMatchObject({queue_state:cancelled?"cancelled":"pending",lease_epoch:5,lease_device_id:null});
    expect(await sqlRunApiStores.leases.renew({ runId,epoch:4,ttlMs:60_000 })).toBe(false);
  });
  it("expires only pending local runs after 24 hours and preserves cancellation", async () => {
    const expired = await createRun();
    const cancelled = await createRun();
    const recent = await createRun();
    const active = await createRun();
    const cloud = await createRun();
    await pool.query("UPDATE task_run_dispatches SET queue_state='pending' WHERE run_id = ANY($1::uuid[])", [[expired.runId, cancelled.runId, recent.runId, cloud.runId]]);
    await pool.query("UPDATE task_run_dispatches SET eligible_at=now()-interval '25 hours' WHERE run_id = ANY($1::uuid[])", [[expired.runId,cancelled.runId,active.runId,cloud.runId]]);
    await pool.query("UPDATE tasks SET cancellation_requested=true WHERE id=$1", [cancelled.taskId]);
    await pool.query("UPDATE task_run_dispatches SET payload_json=payload_json-'executionTarget' WHERE run_id=$1", [cloud.runId]);
    expect(await expireUnavailableLocalRunsOnce()).toBe(2);
    const tasks = (await pool.query("SELECT id,status,cancellation_requested FROM tasks WHERE id=ANY($1::uuid[])", [[expired.taskId,cancelled.taskId,recent.taskId,active.taskId,cloud.taskId]])).rows;
    expect(tasks.find((task) => task.id === expired.taskId).status).toBe("failed");
    expect(tasks.find((task) => task.id === cancelled.taskId)).toMatchObject({ status: "cancelled", cancellation_requested: true });
    for (const task of [recent,active,cloud]) expect(tasks.find((row) => row.id === task.taskId).status).toBe("queued");
    expect((await pool.query("SELECT ended_at,exit_reason FROM task_runs WHERE id=$1", [expired.runId])).rows[0]).toMatchObject({ ended_at: expect.any(Date),exit_reason: "device_unavailable" });
    await pool.query("UPDATE task_run_dispatches SET queue_state='finished' WHERE run_id=ANY($1::uuid[])", [[recent.runId,active.runId,cloud.runId]]);
  });
  it("restores a missing local dispatch without ever adding a cloud job", async () => {
    const { runId } = await createRun();
    await pool.query("DELETE FROM task_run_dispatches WHERE run_id=$1",[runId]);
    await recoverQueuedTaskRunsOnce();
    expect((await pool.query("SELECT payload_json FROM task_run_dispatches WHERE run_id=$1",[runId])).rows[0].payload_json.executionTarget).toEqual(target);
    expect(taskQueue.add).not.toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ runId }), expect.anything());
  });
});
