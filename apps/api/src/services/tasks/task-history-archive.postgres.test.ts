import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { Client, type PoolClient } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { archiveTaskHistory, archiveTaskHistorySegments, convertTaskHistoryArchive, ensureTaskHistoryWarm,
  readTaskHistoryPayloads, loadConversationPublicIndex, deleteTaskHistoryArchiveByKey, TASK_HISTORY_SEGMENT_CANDIDATE_SQL,
  type TaskHistoryArchiveDeps, type TaskHistoryArchiveQueryable } from "@meowbert/shared";

vi.mock("../../lib/config.js", () => ({ config: { taskHistoryArchive: { enabled: true } } }));
vi.mock("./task-cleanup.js", () => ({
  deleteTaskTreesInTx: vi.fn(async () => ({ taskIds: [], taskRootPaths: [], workspacePaths: [], archiveKeys: [] }))
}));

import { config } from "../../lib/config.js";
import { applyWorkflowTransitionInTx } from "./task-workflow-transitions.js";

const databaseUrl = process.env.TEST_COLD_STORAGE_DATABASE_URL;
const schemaSql = `
 CREATE TABLE tasks(id uuid PRIMARY KEY, workspace_id uuid, environment_id uuid, status text DEFAULT 'completed',
   execution_target jsonb, title text, source text, initiator_user_id uuid, default_timezone text, allow_waiting boolean,
   task_root_path text, workflow_type text, workflow_parent_task_id uuid, workflow_internal_role text,
   cancellation_requested boolean DEFAULT false, resume_after_interrupt boolean DEFAULT false,
   completed_at timestamptz, updated_at timestamptz DEFAULT now(),
   task_history_state text DEFAULT 'warm', task_history_archive_key text, task_history_archive_failed_attempts int DEFAULT 0,
   task_history_last_active_at timestamptz DEFAULT '2026-09-01', task_history_last_warmed_at timestamptz,
   task_history_archived_at timestamptz, task_history_archive_started_at timestamptz, task_history_archive_error text);
 CREATE TABLE task_schedules(task_id uuid PRIMARY KEY, schedule_state text);
 CREATE TABLE task_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid, started_at timestamptz, ended_at timestamptz);
 CREATE TABLE task_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid, role text, content_json jsonb,
   token_usage_json jsonb, parent_message_id uuid, message_metadata_json jsonb, created_at timestamptz DEFAULT now());
 CREATE TABLE task_workflows(task_id uuid PRIMARY KEY, workflow_type text, phase text, config_json jsonb, state_json jsonb, updated_at timestamptz DEFAULT now());
 CREATE TABLE task_workflow_agents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workflow_task_id uuid, role text, slot_index int, task_id uuid, state_json jsonb);
 CREATE TABLE task_swarms(task_id uuid PRIMARY KEY);
 CREATE TABLE task_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid, payload_json jsonb, created_at timestamptz DEFAULT now());
 CREATE TABLE task_message_revisions(id uuid PRIMARY KEY, task_id uuid, old_content_json jsonb, new_content_json jsonb, created_at timestamptz DEFAULT now());
 CREATE TABLE task_context_windows(id uuid PRIMARY KEY, task_id uuid, ordinal int, closed_at timestamptz, opening_prompt_json jsonb, request_state_json jsonb);
 CREATE TABLE task_context_history_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid, window_id uuid, ordinal int, payload_json jsonb);
 CREATE TABLE task_context_notes(id uuid PRIMARY KEY, task_id uuid, content text);
 CREATE TABLE task_subagent_sessions(task_id uuid PRIMARY KEY, runtime_json jsonb);
 CREATE TABLE task_subagent_mail(id uuid PRIMARY KEY, recipient_task_id uuid, body text, delivered_at timestamptz);
 CREATE TABLE task_subagent_waits(task_id uuid PRIMARY KEY, resume_job_json jsonb);
 CREATE TABLE task_swarm_fork_seeds(id uuid PRIMARY KEY, swarm_task_id uuid, envelope_json jsonb, tools_json jsonb, items_json jsonb);
 CREATE TABLE task_swarm_notes(seq bigserial PRIMARY KEY, swarm_task_id uuid, content text);
 CREATE TABLE task_swarm_lanes(task_id uuid PRIMARY KEY, result_json jsonb);
 CREATE TABLE task_media_blobs(task_id uuid, sha256 text, mime_type text, bytes bytea, PRIMARY KEY(task_id,sha256));
 CREATE TABLE task_conversation_snapshots(id uuid PRIMARY KEY, task_id uuid, payload_json jsonb);
 CREATE TABLE devices(id uuid PRIMARY KEY);
 CREATE TABLE device_file_tombstones(device_id uuid, workspace_id uuid, kind text, target_id uuid, relative_path text);`;

describe.skipIf(!databaseUrl)("cold storage in PostgreSQL", () => {
  const client = new Client({ connectionString: databaseUrl });
  const schema = `cold_storage_${randomUUID().replaceAll("-", "")}`;
  const query = (sql: string, params?: unknown[]) => client.query(sql, params);
  let directory: string;
  let deps: TaskHistoryArchiveDeps;
  beforeAll(async () => {
    await client.connect();
    await query(`CREATE SCHEMA ${schema}; SET search_path TO ${schema}; SET TIME ZONE 'UTC'`);
    await query(schemaSql);
    await query(await fs.readFile(new URL("../../../../../db/migrations/159_history_index_deletions.sql", import.meta.url), "utf8"));
    await query(await fs.readFile(new URL("../../../../../db/migrations/160_task_history_payload_chunks.sql", import.meta.url), "utf8"));
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "cold-storage-pg-"));
    deps = { archiveConfig: { enabled: true, rootPath: directory, mountPath: directory, archivesDir: "history" },
      now: () => new Date("2026-11-01T00:00:00Z"), db: { query, withTransaction: async (fn) => {
        await query("BEGIN");
        try { const result = await fn({ query }); await query("COMMIT"); return result; }
        catch (error) { await query("ROLLBACK"); throw error; }
      } } } as TaskHistoryArchiveDeps;
    Object.assign(config.taskHistoryArchive, deps.archiveConfig);
  });
  beforeEach(async () => { await query("DELETE FROM tasks"); });
  afterAll(async () => {
    await query(`DROP SCHEMA ${schema} CASCADE`); await client.end();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });
  async function seed(count = 1) {
    const taskId = randomUUID();
    await query("INSERT INTO tasks(id,workspace_id,environment_id) VALUES($1,$2,$3)", [taskId, randomUUID(), randomUUID()]);
    const result = await query(`INSERT INTO task_messages(task_id,role,content_json,created_at)
      SELECT $1,'assistant',jsonb_build_object('text','message ' || n),'2026-09-01'::timestamptz + n * interval '1 second'
      FROM generate_series(1,$2::int) n RETURNING id,content_json`, [taskId,count]);
    return { taskId, messages: result.rows };
  }
  async function seedWindows(taskId: string) {
    const old = randomUUID(); const current = randomUUID();
    await query(`INSERT INTO task_context_windows VALUES($1,$3,1,'2026-09-02','[{"role":"developer","content":"old prompt"}]','{"old":true}'),
      ($2,$3,2,NULL,'[{"role":"developer","content":"current prompt"}]','{"current":true}')`, [old,current,taskId]);
    await query(`INSERT INTO task_context_history_items(task_id,window_id,ordinal,payload_json)
      SELECT $1,$2,n,jsonb_build_object('role','user','content','old ' || n) FROM generate_series(1,130) n`, [taskId,old]);
    await query(`INSERT INTO task_context_history_items(task_id,window_id,ordinal,payload_json) VALUES($1,$2,1,'{"role":"user","content":"current"}')`,[taskId,current]);
    await query("INSERT INTO task_context_notes VALUES($1,$2,'effective notes')",[randomUUID(),taskId]);
    return { old,current };
  }
  it("browses archived messages without restoring payloads or changing activity", async () => {
    const {taskId,messages} = await seed(260);
    expect((await archiveTaskHistory(taskId,deps)).status).toBe("archived");
    const stub = (await query("SELECT id,content_json FROM task_messages WHERE id=$1",[messages[150].id])).rows;
    expect(stub[0].content_json).toEqual({text:""});
    expect((await readTaskHistoryPayloads(taskId,"messages",stub,deps))[0].content_json).toEqual(messages[150].content_json);
    const state = (await query("SELECT task_history_state,task_history_last_warmed_at,task_history_last_active_at FROM tasks WHERE id=$1",[taskId])).rows[0];
    expect(state.task_history_state).toBe("archived"); expect(state.task_history_last_warmed_at).toBeNull();
    expect(state.task_history_last_active_at.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect((await query("SELECT content_json FROM task_messages WHERE id=$1",[messages[150].id])).rows[0].content_json).toEqual({text:""});
    expect((await ensureTaskHistoryWarm(taskId,deps)).status).toBe("restored");
    expect((await query("SELECT content_json FROM task_messages WHERE id=$1",[messages[150].id])).rows[0].content_json).toEqual(messages[150].content_json);
  });
  it("cools old portions of an active scheduled task while keeping its working state warm", async () => {
    const {taskId,messages} = await seed(260); const windows = await seedWindows(taskId);
    await query("UPDATE tasks SET status='running',task_history_last_active_at='2026-11-01' WHERE id=$1",[taskId]);
    await query("INSERT INTO task_schedules VALUES($1,'active');",[taskId]);
    await query("INSERT INTO task_runs(task_id,started_at) VALUES($1,'2026-11-01')",[taskId]);
    expect((await query(TASK_HISTORY_SEGMENT_CANDIDATE_SQL,["2026-10-01"])).rows.some((row) => row.id===taskId)).toBe(true);
    expect((await archiveTaskHistorySegments(taskId,"2026-10-01",deps)).status).toBe("archived");
    const state = (await query("SELECT status,task_history_state FROM tasks WHERE id=$1",[taskId])).rows[0];
    expect(state).toEqual({status:"running",task_history_state:"warm"});
    expect((await query("SELECT payload_json FROM task_context_history_items WHERE window_id=$1",[windows.current])).rows[0].payload_json.content).toBe("current");
    expect((await query("SELECT content FROM task_context_notes WHERE task_id=$1",[taskId])).rows[0].content).toBe("effective notes");
    const cold = (await query("SELECT id,payload_json FROM task_context_history_items WHERE window_id=$1 ORDER BY ordinal LIMIT 1",[windows.old])).rows;
    expect(cold[0].payload_json).toEqual({});
    expect((await readTaskHistoryPayloads(taskId,"context_history",cold,deps))[0].payload_json.content).toBe("old 1");
    expect((await query("SELECT content_json FROM task_messages WHERE id=$1",[messages[259].id])).rows[0].content_json.text).toBe("message 260");
    expect((await archiveTaskHistorySegments(taskId,"2026-10-01",deps)).status).toBe("archived");
    expect((await query(TASK_HISTORY_SEGMENT_CANDIDATE_SQL,["2026-10-01"])).rows.some((row) => row.id === taskId)).toBe(false);
    // Whole-task archive must merge already-cold portions rather than archive their stubs.
    await query("UPDATE tasks SET status='completed' WHERE id=$1",[taskId]);
    await query("UPDATE task_schedules SET schedule_state='paused' WHERE task_id=$1",[taskId]);
    expect((await archiveTaskHistory(taskId,deps)).status).toBe("archived");
    await ensureTaskHistoryWarm(taskId,deps);
    expect((await query("SELECT content_json FROM task_messages WHERE id=$1",[messages[0].id])).rows[0].content_json).toEqual(messages[0].content_json);
    expect((await query("SELECT payload_json FROM task_context_history_items WHERE id=$1",[cold[0].id])).rows[0].payload_json.content).toBe("old 1");
  });
  it("execution restores open windows while leaving closed history and conversation payloads cold", async () => {
    const {taskId,messages} = await seed(2); const windows = await seedWindows(taskId);
    await archiveTaskHistory(taskId,deps);
    await ensureTaskHistoryWarm(taskId,deps,{executionOnly:true});
    expect((await query("SELECT payload_json FROM task_context_history_items WHERE window_id=$1",[windows.current])).rows[0].payload_json.content).toBe("current");
    expect((await query("SELECT payload_json FROM task_context_history_items WHERE window_id=$1 ORDER BY ordinal LIMIT 1",[windows.old])).rows[0].payload_json).toEqual({});
    const cold = (await query("SELECT id,content_json FROM task_messages WHERE id=$1",[messages[0].id])).rows;
    expect(cold[0].content_json).toEqual({text:""});
    expect((await readTaskHistoryPayloads(taskId,"messages",cold,deps))[0].content_json).toEqual(messages[0].content_json);
  });
  it.each(["long_horizon", "deep_research", "quality_control"] as const)("preserves a cooled initial prompt when converting to %s", async (workflowType) => {
    const { taskId, messages } = await seed(260);
    const prompt = "Build an offline inventory app with CSV export and no external services.";
    await query("UPDATE task_messages SET role='user',content_json=$2 WHERE id=$1", [messages[0].id, { text: prompt }]);
    expect((await archiveTaskHistorySegments(taskId, "2026-10-01", deps)).status).toBe("archived");
    expect((await query("SELECT content_json FROM task_messages WHERE id=$1", [messages[0].id])).rows[0].content_json).toEqual({ text: "" });
    const task = (await query("SELECT * FROM tasks WHERE id=$1", [taskId])).rows[0];

    await query("BEGIN");
    try {
      await applyWorkflowTransitionInTx(client as unknown as PoolClient, {
        taskId, userId: randomUUID(), task: { ...task, title: "Inventory", default_timezone: "UTC", allow_waiting: true },
        workflow: { type: workflowType }
      });
      await query("COMMIT");
    } catch (error) {
      await query("ROLLBACK");
      throw error;
    }

    const reviewers = (await query(`SELECT m.content_json FROM task_messages m JOIN tasks t ON t.id=m.task_id
      WHERE t.workflow_parent_task_id=$1 AND t.workflow_internal_role='reviewer'`, [taskId])).rows;
    expect(reviewers).toHaveLength(1);
    expect(reviewers[0].content_json.text).toContain(prompt);
    expect((await query("SELECT content_json FROM task_messages WHERE id=$1", [messages[0].id])).rows[0].content_json).toEqual({ text: "" });
    expect((await query("SELECT task_history_state FROM tasks WHERE id=$1", [taskId])).rows[0].task_history_state).toBe("warm");
  });
  it.each(["warm", "mixed", "restored"] as const)("keeps navigation query and hydration results bounded for %s history", async (residency) => {
    const { taskId, messages } = await seed(260);
    const initialText = "Original requirements ".repeat(100);
    const latestText = "Latest answer ".repeat(100);
    await query(`UPDATE task_messages SET parent_message_id=previous.parent_id FROM (
      SELECT id, lag(id) OVER (ORDER BY created_at,id) AS parent_id FROM task_messages WHERE task_id=$1
    ) previous WHERE task_messages.id=previous.id`, [taskId]);
    await query("UPDATE task_messages SET role='user',content_json=$2 WHERE id=$1", [messages[0].id, { text: initialText }]);
    await query("UPDATE task_messages SET content_json=$2 WHERE id=$1", [messages[259].id, {
      text: latestText, turn_summary: "Inventory export", response_items: ["x".repeat(2_000_000)]
    }]);
    if (residency !== "warm") await archiveTaskHistorySegments(taskId, "2026-10-01", deps);
    const querySizes: number[] = [];
    const hydrationSizes: number[] = [];
    const db: TaskHistoryArchiveQueryable = {
      query: async (sql, params) => {
        const result = await query(sql, params);
        querySizes.push(Buffer.byteLength(JSON.stringify(result.rows)));
        if (residency === "restored" && sql.startsWith("WITH RECURSIVE lineage")) await ensureTaskHistoryWarm(taskId, deps);
        return result;
      },
      readPayloads: async (id, kind, rows, projection) => {
        const hydrated = await readTaskHistoryPayloads(id, kind, rows, { ...deps, db }, projection);
        hydrationSizes.push(Buffer.byteLength(JSON.stringify(hydrated)));
        return hydrated;
      }
    };

    const index = await loadConversationPublicIndex(db, taskId, messages[259].id);
    expect(index).toHaveLength(260);
    expect(index[0].text).toBe(initialText.slice(0, 500));
    expect(index[259]).toMatchObject({ text: latestText.slice(0, 500), summary: "Inventory export" });
    expect(index.every((row) => !("content_json" in row) && !("token_usage_json" in row))).toBe(true);
    expect(Math.max(...querySizes, ...hydrationSizes)).toBeLessThan(260 * 2_000);
    expect((await query("SELECT content_json FROM task_messages WHERE id=$1", [messages[0].id])).rows[0].content_json.text)
      .toBe(residency === "mixed" ? "" : initialText);
  });
  it("preserves an edit made after capture and never overlays it from a neighboring chunk", async () => {
    const {taskId,messages} = await seed(260); let transaction = 0;
    const raced = { ...deps, db: { ...deps.db, withTransaction: async (fn: Parameters<typeof deps.db.withTransaction>[0]) => {
      if (++transaction===2) await query(`UPDATE task_messages SET content_json='{"text":"concurrent edit"}' WHERE id=$1`,[messages[0].id]);
      return deps.db.withTransaction(fn);
    } } } as TaskHistoryArchiveDeps;
    await archiveTaskHistorySegments(taskId,"2026-10-01",raced);
    const rows = (await query("SELECT id,content_json FROM task_messages WHERE id=ANY($1::uuid[]) ORDER BY created_at",[[messages[0].id,messages[1].id]])).rows;
    const restored = await readTaskHistoryPayloads(taskId,"messages",rows,deps);
    expect(restored[0].content_json.text).toBe("concurrent edit"); expect(restored[1].content_json.text).toBe("message 2");
  });
  it("resolves rows selected before a concurrent restore instead of returning their stale stubs", async () => {
    const { taskId, messages } = await seed();
    await archiveTaskHistory(taskId, deps);
    const stale = (await query("SELECT id,content_json FROM task_messages WHERE task_id=$1", [taskId])).rows;
    await ensureTaskHistoryWarm(taskId, deps);
    expect((await readTaskHistoryPayloads(taskId, "messages", stale, deps))[0].content_json).toEqual(messages[0].content_json);
  });
  it("materializes remaining cold rows for a fork without overwriting newer working state", async () => {
    const { taskId, messages } = await seed();
    const windows = await seedWindows(taskId);
    await archiveTaskHistory(taskId, deps);
    await ensureTaskHistoryWarm(taskId, deps, { executionOnly: true });
    await query(`UPDATE task_context_windows SET request_state_json='{"current":"new work"}' WHERE id=$1`, [windows.current]);
    await query("UPDATE task_context_notes SET content='new notes' WHERE task_id=$1", [taskId]);
    await ensureTaskHistoryWarm(taskId, deps);
    expect((await query("SELECT content_json FROM task_messages WHERE id=$1", [messages[0].id])).rows[0].content_json).toEqual(messages[0].content_json);
    expect((await query("SELECT request_state_json FROM task_context_windows WHERE id=$1", [windows.current])).rows[0].request_state_json).toEqual({ current: "new work" });
    expect((await query("SELECT content FROM task_context_notes WHERE task_id=$1", [taskId])).rows[0].content).toBe("new notes");
    expect((await query("SELECT * FROM task_history_payloads WHERE task_id=$1", [taskId])).rows).toHaveLength(0);
  });
  it("keeps warm source rows intact when a segment archive cannot be written", async () => {
    const { taskId, messages } = await seed(260);
    const failed = { ...deps, archiveConfig: { ...deps.archiveConfig, rootPath: "/dev/null/unwritable-history" } };
    await expect(archiveTaskHistorySegments(taskId, "2026-10-01", failed)).rejects.toThrow();
    expect((await query("SELECT content_json FROM task_messages WHERE id=$1", [messages[0].id])).rows[0].content_json).toEqual(messages[0].content_json);
    expect((await query("SELECT * FROM task_history_payloads WHERE task_id=$1", [taskId])).rows).toHaveLength(0);
  });
  it("removes task-owned archive chunks when a task that only cooled segments is deleted", async () => {
    const { taskId } = await seed(260);
    const result = await archiveTaskHistorySegments(taskId, "2026-10-01", deps);
    const key = (await query("SELECT task_history_archive_key FROM tasks WHERE id=$1", [taskId])).rows[0].task_history_archive_key;
    expect(key).toBe(result.archiveKey);
    await query("DELETE FROM tasks WHERE id=$1", [taskId]);
    await deleteTaskHistoryArchiveByKey(deps.archiveConfig, key);
    await expect(fs.stat(path.join(directory, key))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("keeps cold media and navigation through execution, rearchival, and a full restore", async () => {
    const { taskId } = await seed();
    await seedWindows(taskId);
    const snapshotId = randomUUID();
    await query("INSERT INTO task_media_blobs VALUES($1,'image-hash','image/png',$2)", [taskId, Buffer.from("image bytes")]);
    await query(`INSERT INTO task_conversation_snapshots VALUES($1,$2,'{"markdown":"outline"}')`, [snapshotId, taskId]);
    await archiveTaskHistory(taskId, deps);
    await ensureTaskHistoryWarm(taskId, deps, { executionOnly: true });
    expect((await query("SELECT * FROM task_media_blobs WHERE task_id=$1", [taskId])).rows).toHaveLength(0);
    expect((await query("SELECT task_history_last_active_at FROM tasks WHERE id=$1", [taskId])).rows[0].task_history_last_active_at.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    await archiveTaskHistory(taskId, deps);
    await ensureTaskHistoryWarm(taskId, deps);
    expect((await query("SELECT bytes FROM task_media_blobs WHERE task_id=$1", [taskId])).rows[0].bytes.toString()).toBe("image bytes");
    expect((await query("SELECT payload_json FROM task_conversation_snapshots WHERE id=$1", [snapshotId])).rows[0].payload_json).toEqual({ markdown: "outline" });
    expect((await query("SELECT * FROM task_history_payloads WHERE task_id=$1", [taskId])).rows).toHaveLength(0);
  });
  it("invalidates history indexes and device scratch on every whole-task archival", async () => {
    const { taskId } = await seed();
    const deviceId = randomUUID();
    await query("INSERT INTO devices VALUES($1)", [deviceId]);
    await query("UPDATE tasks SET execution_target=jsonb_build_object('kind','local','deviceId',$2::text) WHERE id=$1", [taskId, deviceId]);
    await archiveTaskHistory(taskId, deps);
    await ensureTaskHistoryWarm(taskId, deps, { executionOnly: true });
    await archiveTaskHistory(taskId, deps);
    expect((await query("SELECT * FROM history_index_deletions WHERE task_id=$1", [taskId])).rows).toHaveLength(2);
    expect((await query("SELECT * FROM device_file_tombstones WHERE target_id=$1", [taskId])).rows).toHaveLength(2);
  });
  it("browses and converts a legacy archive without a database restoration", async () => {
    const {taskId,messages} = await seed();
    const task = (await query("SELECT * FROM tasks WHERE id=$1",[taskId])).rows[0];
    const key = `v1/workspaces/${task.workspace_id}/environments/${task.environment_id}/tasks/${taskId}.json.gz`;
    await fs.mkdir(path.dirname(path.join(directory,key)),{recursive:true});
    await fs.writeFile(path.join(directory,key),gzipSync(JSON.stringify({version:1,task:{id:taskId,workspace_id:task.workspace_id,environment_id:task.environment_id,
      archived_at:new Date().toISOString(),last_active_at:new Date().toISOString()},messages:messages.map((m) => ({...m,token_usage_json:null})),events:[],message_revisions:[]})));
    await query("UPDATE tasks SET task_history_state='archived',task_history_archive_key=$2 WHERE id=$1",[taskId,key]);
    await query(`UPDATE task_messages SET content_json='{"text":""}' WHERE task_id=$1`,[taskId]);
    const rows = (await query("SELECT id,content_json FROM task_messages WHERE task_id=$1",[taskId])).rows;
    expect((await readTaskHistoryPayloads(taskId,"messages",rows,deps))[0].content_json.text).toBe("message 1");
    expect((await query("SELECT task_history_archive_conversion_requested FROM tasks WHERE id=$1",[taskId])).rows[0].task_history_archive_conversion_requested).toBe(true);
    const failed = { ...deps, db: { ...deps.db, withTransaction: async () => { throw new Error("interrupted publication"); } } };
    await expect(convertTaskHistoryArchive(taskId, failed)).rejects.toThrow("interrupted publication");
    expect((await query("SELECT task_history_archive_key FROM tasks WHERE id=$1", [taskId])).rows[0].task_history_archive_key).toBe(key);
    expect((await readTaskHistoryPayloads(taskId, "messages", rows, deps))[0].content_json.text).toBe("message 1");
    expect((await convertTaskHistoryArchive(taskId,deps)).status).toBe("archived");
    expect((await readTaskHistoryPayloads(taskId,"messages",rows,deps))[0].content_json.text).toBe("message 1");
    expect((await query("SELECT content_json FROM task_messages WHERE task_id=$1",[taskId])).rows[0].content_json).toEqual({text:""});
    expect(await fs.stat(path.join(directory,key))).toBeTruthy();
  });
});
