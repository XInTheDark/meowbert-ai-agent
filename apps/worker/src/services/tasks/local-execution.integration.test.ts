import { RUN_API_PROTOCOL_VERSION } from "@meowbert/shared";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", async () => (await import("./local-execution.test-fixtures.js")).database);
vi.mock("../../../../api/src/lib/db.js", async () => (await import("./local-execution.test-fixtures.js")).database);
vi.mock("../../../../api/src/lib/config.js", () => ({ config: { runApi: { url: "http://worker" } } }));
vi.mock("../../lib/queue.js", () => ({ taskQueue: { getJob: vi.fn(), add: vi.fn() } }));
vi.mock("../runtime/events.js", () => ({ emitTaskEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../agent-db/index.js", () => ({ resolveContinuationBranchMessageId: vi.fn(), resolveLatestBranchSelectionUserId: vi.fn() }));
vi.mock("../runtime/debug-task-events.js", () => ({ createTaskDebugLogger: vi.fn() }));
vi.mock("../../lib/config.js", () => ({ config: { localExecution: { enabled: true } } }));
const { pool, database } = await import("./local-execution.test-fixtures.js");
const { claimLocalRun, refuseLocalRunForStorage } = await import("../../../../api/src/services/devices/device-claims.js");
const { expireUnavailableLocalRunsOnce, reclaimExpiredLocalRunLeasesOnce, recoverQueuedTaskRunsOnce } = await import("./task-run-recovery.js");
const { sqlRunApiStores } = await import("../run-api/sql-stores.js");
const { taskQueue } = await import("../../lib/queue.js");
const { markTaskArtifacts } = await import("../agent/artifacts.js");
const { publishPendingArtifactsOnce } = await import("./artifact-publication.js");
const { loadTaskOutputFiles } = await import("../agent-db/task-output-files.js");
const { recordTaskUpload, lockTaskInputUploads, attachPendingTaskInputs, removeTaskInputUploads } = await import("../../../../api/src/services/files/task-upload-manifest.js");
const { recordToolCallStarted, listUnfinishedToolCalls, clearInterruptedToolCalls } = await import("../run-host/tool-call-records.js");
const { resolveRunLeaseHolderUrl } = await import("../../../../api/src/services/runs/run-api-forwarding.js");
const { loadRunInputManifest } = await import("../run-host/input-manifest.js");
const { completeTaskRun } = await import("./complete-task-run.js");

describe.skipIf(!process.env.TEST_LOCAL_EXECUTION_DATABASE_URL)("local execution PostgreSQL lifecycle", () => {
  const userId = randomUUID(); const workspaceId = randomUUID(); const projectId = randomUUID(); const deviceId = randomUUID();
  const target = { kind: "local", deviceId, mode: "sandbox" };
  let projectRoot: string;
  beforeAll(async () => {
    projectRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-local-integration-")));
    await pool.query("INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'test')", [userId, userId + "@test.invalid"]);
    await pool.query("INSERT INTO workspaces (id, name, slug, storage_backend_id) VALUES ($1, 'Local', $2, 'backend')", [workspaceId, workspaceId]);
    await pool.query("INSERT INTO environments (id, workspace_id, name, root_path) VALUES ($1, $2, 'Local', $3)", [projectId, workspaceId, projectRoot]);
    await pool.query(
      "INSERT INTO devices (id,user_id,name,platform,architecture,executor_version,capabilities_json,verified_roots_json,last_seen_at,stream_expires_at) VALUES ($1,$2,'Mac','darwin','arm64','1',$3,'{\"backend\":\"/runtime\"}',now(),now()+interval '1 hour')",
      [deviceId, userId, JSON.stringify({ dockerReady: true, sandboxImageReady: true, executorSupported: true, protocolVersion: RUN_API_PROTOCOL_VERSION })]
    );
  });
  afterAll(async () => {
    await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId]);
    await pool.query("DELETE FROM users WHERE id = $1", [userId]); await pool.end();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });
  async function createRun() {
    const taskId = randomUUID(); const runId = randomUUID();
    await pool.query("INSERT INTO tasks(id,workspace_id,environment_id,status,task_root_path,execution_target) VALUES ($1,$2,$3,'queued',$4,$5)", [taskId,workspaceId,projectId,".meowbert/task-runs/"+taskId,target]);
    await pool.query("INSERT INTO task_runs(id,task_id,attempt_no,run_kind) VALUES ($1,$2,1,'default')", [runId,taskId]);
    const job = { taskId,runId,workspaceId,environmentId:projectId,triggerSource:"web",executionTarget:target };
    await pool.query("INSERT INTO task_run_dispatches(run_id,task_id,workspace_id,environment_id,dispatch_class,queue_state,payload_json,admitted_at) VALUES ($1,$2,$3,$4,'interactive_new','admitted',$5,now())", [runId,taskId,workspaceId,projectId,job]);
    return { taskId,runId };
  }
  it("keeps composer input integrity before task creation and associates it atomically", async () => {
    const taskId = randomUUID(); const taskRoot = ".meowbert/task-runs/" + taskId;
    const file = { name: "pending.txt", relativePath: taskRoot + "/inputs/pending.txt", sizeBytes: 5,
      sha256: createHash("sha256").update("hello").digest("hex"), createdAt: null, modifiedAt: null };
    await recordTaskUpload(projectId, file);
    expect((await pool.query("SELECT size_bytes, sha256 FROM pending_task_inputs WHERE task_id=$1", [taskId])).rows)
      .toEqual([{ size_bytes: "5", sha256: file.sha256 }]);
    await database.withTransaction(async (client) => {
      await lockTaskInputUploads(client, taskId);
      await client.query("INSERT INTO tasks(id,workspace_id,environment_id,task_root_path) VALUES ($1,$2,$3,$4)", [taskId, workspaceId, projectId, taskRoot]);
      await attachPendingTaskInputs(client, projectId, taskId);
    });
    expect(await loadRunInputManifest(taskId)).toEqual([{ relativePath: "inputs/pending.txt", sizeBytes: 5, sha256: file.sha256 }]);
    expect((await pool.query("SELECT * FROM pending_task_inputs WHERE task_id=$1", [taskId])).rows).toEqual([]);
    const updated = { ...file, sizeBytes: 7, sha256: "a".repeat(64) };
    await recordTaskUpload(projectId, updated);
    expect(await loadRunInputManifest(taskId)).toEqual([{ relativePath: "inputs/pending.txt", sizeBytes: 7, sha256: updated.sha256 }]);
  });
  it("returns a refused storage admission to pending only for the owning device", async () => {
    const { runId } = await createRun();
    expect(await refuseLocalRunForStorage({ userId: randomUUID(), deviceId, runId })).toBe(false);
    expect(await refuseLocalRunForStorage({ userId, deviceId, runId })).toBe(true);
    const row = (await pool.query("SELECT queue_state,pending_reason,admitted_at,storage_retry_at > now() AS backoff FROM task_run_dispatches WHERE run_id=$1", [runId])).rows[0];
    expect(row).toEqual({ queue_state: "pending", pending_reason: "waiting_for_storage", admitted_at: null, backoff: true });
    expect(await refuseLocalRunForStorage({ userId, deviceId, runId })).toBe(false);
  });
  it.each([false, true])("does not require deleted staged inputs after creation, folder=%s", async (folder) => {
    const taskId = randomUUID(); const otherTaskId = randomUUID(); const taskRoot = ".meowbert/task-runs/" + taskId;
    const file = { name: "a.txt", relativePath: taskRoot + "/inputs/a.txt", sizeBytes: 1, sha256: "a".repeat(64), createdAt: null, modifiedAt: null };
    const otherProjectId = randomUUID();
    await pool.query("INSERT INTO environments(id,workspace_id,name,root_path) VALUES ($1,$2,'Other',$3)", [otherProjectId, workspaceId, projectRoot]);
    await recordTaskUpload(projectId, file);
    await recordTaskUpload(projectId, { ...file, relativePath: ".meowbert/task-runs/" + otherTaskId + "/inputs/a.txt" });
    await recordTaskUpload(otherProjectId, file);
    await removeTaskInputUploads(projectId, [folder ? taskRoot + "/inputs" : file.relativePath]);
    await database.withTransaction(async (client) => {
      await lockTaskInputUploads(client, taskId);
      await client.query("INSERT INTO tasks(id,workspace_id,environment_id,task_root_path) VALUES ($1,$2,$3,$4)", [taskId, workspaceId, projectId, taskRoot]);
      await attachPendingTaskInputs(client, projectId, taskId);
    });
    expect(await loadRunInputManifest(taskId)).toEqual([]);
    expect((await pool.query("SELECT task_id,environment_id FROM pending_task_inputs WHERE task_id=ANY($1::uuid[]) ORDER BY environment_id,task_id", [[taskId, otherTaskId]])).rows)
      .toEqual(expect.arrayContaining([{ task_id: taskId, environment_id: otherProjectId }, { task_id: otherTaskId, environment_id: projectId }]));
  });
  it("reports and clears unfinished effects left by a previous lease of the same run", async () => {
    const { taskId, runId } = await createRun();
    const call = { callId: "interrupted-call", name: "run_shell", arguments: "side-effect" };
    await recordToolCallStarted(taskId, runId, call);
    expect(await listUnfinishedToolCalls(taskId)).toEqual([call]);
    await clearInterruptedToolCalls(taskId, [call.callId]);
    expect(await listUnfinishedToolCalls(taskId)).toEqual([]);
  });
  it("releases terminal execution ownership while retaining the same-epoch retry route", async () => {
    const { taskId, runId } = await createRun();
    await claimLocalRun({ userId, deviceId, runId });
    const lease = (await sqlRunApiStores.leases.claim({ runId, holder: "device:" + deviceId, apiUrl: "http://worker", ttlMs: 60_000 }))!;
    await sqlRunApiStores.leases.release({ runId, epoch: lease.epoch });
    const claims = { runId, taskId, epoch: lease.epoch, holder: "device:" + deviceId } as Parameters<typeof resolveRunLeaseHolderUrl>[0];
    expect(await resolveRunLeaseHolderUrl(claims)).toBe("http://worker");
    expect((await pool.query("SELECT lease_holder,lease_expires_at FROM task_run_dispatches WHERE run_id=$1", [runId])).rows[0])
      .toEqual({ lease_holder: null, lease_expires_at: null });
    await pool.query("UPDATE task_run_dispatches SET lease_epoch=lease_epoch+1,queue_state='finished' WHERE run_id=$1", [runId]);
    await expect(resolveRunLeaseHolderUrl(claims)).rejects.toMatchObject({ code: "lease_lost" });
  });
  it("admits a Windows Docker Desktop claim", async () => {
    const { runId } = await createRun();
    await pool.query("UPDATE devices SET platform='win32',architecture='x64' WHERE id=$1", [deviceId]);
    try { expect(await claimLocalRun({ userId, deviceId, runId })).not.toBeNull(); }
    finally {
      await pool.query("UPDATE devices SET platform='darwin',architecture='arm64' WHERE id=$1", [deviceId]);
      await pool.query("UPDATE task_run_dispatches SET queue_state='finished' WHERE run_id=$1", [runId]);
    }
  });
  it("returns invisible inputs to pending without ending the run or resetting its timeout", async () => {
    const { taskId, runId } = await createRun();
    await claimLocalRun({ userId, deviceId, runId });
    const lease = (await sqlRunApiStores.leases.claim({ runId, holder: "device:" + deviceId, apiUrl: "http://worker", ttlMs: 60_000 }))!;
    await pool.query("UPDATE task_run_dispatches SET eligible_at=now()-interval '25 hours' WHERE run_id=$1", [runId]);
    expect(await sqlRunApiStores.leases.releaseForStorage({ runId, epoch: lease.epoch })).toBe(true);
    expect(await sqlRunApiStores.leases.releaseForStorage({ runId, epoch: lease.epoch })).toBe(false);
    const dispatch = (await pool.query("SELECT queue_state,pending_reason,lease_device_id,storage_retry_at > now() AS backoff FROM task_run_dispatches WHERE run_id=$1", [runId])).rows[0];
    expect(dispatch).toMatchObject({ queue_state: "pending", pending_reason: "waiting_for_storage", lease_device_id: null, backoff: true });
    expect((await pool.query("SELECT status FROM tasks WHERE id=$1", [taskId])).rows[0].status).toBe("queued");
    expect((await pool.query("SELECT ended_at FROM task_runs WHERE id=$1", [runId])).rows[0].ended_at).toBeNull();
    expect(await expireUnavailableLocalRunsOnce()).toBe(1);
  });
  it("stores input integrity and publishes a lagging artifact before later tasks can reuse it", async () => {
    const { taskId } = await createRun();
    const taskRoot = ".meowbert/task-runs/" + taskId;
    const digest = createHash("sha256").update("hello").digest("hex");
    await recordTaskUpload(projectId, { name: "in.txt", relativePath: taskRoot + "/inputs/in.txt", sizeBytes: 5, sha256: digest, createdAt: null, modifiedAt: null });
    expect(await loadRunInputManifest(taskId)).toEqual([{ relativePath: "inputs/in.txt", sizeBytes: 5, sha256: digest }]);
    await markTaskArtifacts(taskId, [{ relativePath: "out.txt", size: 5, sha256: digest }], true);
    expect(await loadTaskOutputFiles(pool, taskId)).toEqual([]);
    await publishPendingArtifactsOnce();
    expect((await pool.query("SELECT publication_state FROM task_artifacts WHERE task_id=$1 AND kind='artifact'", [taskId])).rows[0].publication_state).toBe("pending");
    await fs.mkdir(path.join(projectRoot, taskRoot), { recursive: true });
    await fs.writeFile(path.join(projectRoot, taskRoot, "out.txt"), "hello");
    await pool.query("UPDATE task_artifacts SET publication_next_check_at=now() WHERE task_id=$1", [taskId]);
    await publishPendingArtifactsOnce();
    expect(await loadTaskOutputFiles(pool, taskId)).toEqual([taskRoot + "/out.txt"]);
  });
  it("does not release a superseded device run or reset its newer task status", async () => {
    const { taskId, runId } = await createRun();
    await claimLocalRun({ userId, deviceId, runId });
    const lease = (await sqlRunApiStores.leases.claim({ runId, holder: "device:" + deviceId, apiUrl: "http://worker", ttlMs: 60_000 }))!;
    await pool.query("INSERT INTO task_runs(id,task_id,attempt_no,run_kind) VALUES ($1,$2,2,'default')", [randomUUID(), taskId]);
    await pool.query("UPDATE tasks SET status='running' WHERE id=$1", [taskId]);
    expect(await sqlRunApiStores.leases.releaseForStorage({ runId, epoch: lease.epoch })).toBe(false);
    expect((await pool.query("SELECT status FROM tasks WHERE id=$1", [taskId])).rows[0].status).toBe("running");
    await pool.query("UPDATE task_run_dispatches SET queue_state='finished' WHERE run_id=$1", [runId]);
  });
  it("commits all memory refresh times with successful local completion exactly once", async () => {
    const { taskId, runId } = await createRun();
    const completion = { taskId, runId, workspaceId, environmentId: projectId, finalResponse: "Done", notificationRequested: false, isSubtask: false, connectorContextId: null };
    expect(await completeTaskRun(completion)).toBe(true);
    expect(await completeTaskRun(completion)).toBe(false);
    const refreshes = (await pool.query("SELECT delay_seconds FROM local_run_memory_refreshes WHERE run_id=$1 ORDER BY delay_seconds", [runId])).rows;
    expect(refreshes.map((row) => row.delay_seconds)).toEqual([0, 60, 300]);
  });
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
