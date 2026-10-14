import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimPendingMasterReports, formatMasterReport } from "./reports.js";

// Supply a disposable PostgreSQL database; each run uses and removes its own schema.
const databaseUrl = process.env.TEST_PROJECT_MASTER_DATABASE_URL;
describe.skipIf(!databaseUrl)("Project Master reports in PostgreSQL", () => {
  const client = new Client({ connectionString: databaseUrl });
  const schema = `project_master_test_${randomUUID().replaceAll("-", "")}`;
  const environmentId = randomUUID();
  const masterTaskId = randomUUID();

  async function createTask(status = "queued"): Promise<string> {
    const taskId = randomUUID();
    await client.query("INSERT INTO tasks(id, environment_id, title, status) VALUES ($1, $2, $3, $4)",
      [taskId, environmentId, `Task ${taskId.slice(0, 4)}`, status]);
    return taskId;
  }

  // Each run answers a fresh user message, written by the Master unless sender says otherwise.
  async function finishRun(
    taskId: string,
    status: string,
    reply: string | null,
    sender: "project_master" | null = "project_master"
  ): Promise<string> {
    const runId = randomUUID();
    await client.query("INSERT INTO task_messages(task_id, role, content_json) VALUES ($1, 'user', $2)",
      [taskId, JSON.stringify({ text: "Next step", ...(sender ? { sender } : {}) })]);
    await client.query(
      "INSERT INTO task_runs(id, task_id, attempt_no) SELECT $1, $2, COALESCE(MAX(attempt_no), 0) + 1 FROM task_runs WHERE task_id = $2",
      [runId, taskId]
    );
    await client.query("UPDATE tasks SET status = 'running' WHERE id = $1", [taskId]);
    if (reply) await client.query("INSERT INTO task_messages(task_id, role, content_json) VALUES ($1, 'assistant', $2)",
      [taskId, JSON.stringify({ text: reply })]);
    await client.query("UPDATE tasks SET status = $2 WHERE id = $1", [taskId, status]);
    return runId;
  }

  async function pendingReports(taskId: string) {
    const result = await client.query<{ status: string; run_id: string }>(
      "SELECT status, run_id FROM project_master_reports WHERE task_id = $1 AND delivered_at IS NULL ORDER BY created_at", [taskId]
    );
    return result.rows;
  }

  beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`);
    await client.query(`CREATE TABLE environments(id uuid PRIMARY KEY);
      CREATE TABLE users(id uuid PRIMARY KEY);
      CREATE TABLE tasks(id uuid PRIMARY KEY, environment_id uuid, title text, status text, updated_at timestamptz DEFAULT now(),
        task_root_path text);
      CREATE TABLE task_artifacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid REFERENCES tasks(id), kind text,
        relative_path text, created_at timestamptz DEFAULT now());
      CREATE TABLE task_runs(id uuid PRIMARY KEY, task_id uuid REFERENCES tasks(id), attempt_no integer, error_summary text,
        run_kind text NOT NULL DEFAULT 'default', started_at timestamptz NOT NULL DEFAULT clock_timestamp(), ended_at timestamptz);
      CREATE TABLE task_messages(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid REFERENCES tasks(id), role text,
        content_json jsonb, created_at timestamptz DEFAULT clock_timestamp());`);
    for (const migration of ["126_project_master.sql", "132_project_master_report_routing.sql"]) {
      await client.query(await readFile(new URL(`../../../../../db/migrations/${migration}`, import.meta.url), "utf8"));
    }
    await client.query("INSERT INTO environments VALUES ($1)", [environmentId]);
    await client.query("INSERT INTO tasks(id, environment_id, title, status) VALUES ($1, $2, 'Master', 'succeeded')", [masterTaskId, environmentId]);
    await client.query("INSERT INTO project_masters(environment_id, task_id) VALUES ($1, $2)", [environmentId, masterTaskId]);
  });

  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await client.end();
  });

  it("reports each settled run of a listened task exactly once", async () => {
    const taskId = await createTask();
    await client.query("INSERT INTO project_master_listeners(task_id, master_task_id) VALUES ($1, $2)", [taskId, masterTaskId]);

    const firstRunId = await finishRun(taskId, "succeeded", "Done.");
    await client.query("UPDATE tasks SET status = 'succeeded', title = 'Renamed' WHERE id = $1", [taskId]);
    const secondRunId = await finishRun(taskId, "failed", null);

    expect(await pendingReports(taskId)).toEqual([
      { status: "succeeded", run_id: firstRunId },
      { status: "failed", run_id: secondRunId }
    ]);
  });

  it("ignores tasks nobody listens to and runs that settled before listening began", async () => {
    const unlistened = await createTask();
    await finishRun(unlistened, "succeeded", "Quiet.");
    const lateListen = await createTask();
    await finishRun(lateListen, "succeeded", "Old result.");
    await client.query("INSERT INTO project_master_listeners(task_id, master_task_id) VALUES ($1, $2)", [lateListen, masterTaskId]);

    expect(await pendingReports(unlistened)).toEqual([]);
    expect(await pendingReports(lateListen)).toEqual([]);
  });

  it("claims pending reports once with the task's latest reply", async () => {
    await client.query("DELETE FROM project_master_reports");
    const taskId = await createTask();
    await client.query("INSERT INTO project_master_listeners(task_id, master_task_id) VALUES ($1, $2)", [taskId, masterTaskId]);
    await finishRun(taskId, "awaiting_input", "Which region should I deploy to?");

    const claimed = await claimPendingMasterReports(client as unknown as PoolClient, masterTaskId, null);
    const claimedAgain = await claimPendingMasterReports(client as unknown as PoolClient, masterTaskId, null);

    expect(claimed).toEqual([expect.objectContaining({
      task_id: taskId,
      status: "awaiting_input",
      latest_response: "Which region should I deploy to?"
    })]);
    expect(claimedAgain).toEqual([]);
  });

  it("lists the files a task produced by their project path so the Master can hand them to later tasks", async () => {
    await client.query("DELETE FROM project_master_reports");
    const taskId = await createTask();
    await client.query("UPDATE tasks SET task_root_path = $2 WHERE id = $1", [taskId, `.meowbert/task-runs/${taskId}`]);
    await client.query("INSERT INTO project_master_listeners(task_id, master_task_id) VALUES ($1, $2)", [taskId, masterTaskId]);
    await client.query("INSERT INTO task_artifacts(task_id, kind, relative_path) VALUES ($1, 'artifact', 'Northwind.pptx')", [taskId]);
    await finishRun(taskId, "succeeded", "Deck is ready.");

    const [report] = await claimPendingMasterReports(client as unknown as PoolClient, masterTaskId, null);

    expect(report.output_files).toEqual([`.meowbert/task-runs/${taskId}/Northwind.pptx`]);
    expect(formatMasterReport(report)).toContain(`.meowbert/task-runs/${taskId}/Northwind.pptx`);
  });

  it("leaves runs the user started on a task to them unless the Master follows the task explicitly", async () => {
    const taskId = await createTask();
    await client.query("INSERT INTO project_master_listeners(task_id, master_task_id) VALUES ($1, $2)", [taskId, masterTaskId]);

    await finishRun(taskId, "succeeded", "Handled your tweak.", null);
    expect(await pendingReports(taskId)).toEqual([]);

    const masterRunId = await finishRun(taskId, "succeeded", "Done as briefed.");
    await client.query("UPDATE project_master_listeners SET include_user_runs = true WHERE task_id = $1", [taskId]);
    const followedRunId = await finishRun(taskId, "succeeded", "Another tweak.", null);
    expect(await pendingReports(taskId)).toEqual([
      { status: "succeeded", run_id: masterRunId },
      { status: "succeeded", run_id: followedRunId }
    ]);
  });

  it("reports scheduled runs even though no Master message started them", async () => {
    const taskId = await createTask();
    await client.query("INSERT INTO project_master_listeners(task_id, master_task_id) VALUES ($1, $2)", [taskId, masterTaskId]);
    const runId = randomUUID();
    await client.query("INSERT INTO task_runs(id, task_id, attempt_no, run_kind) VALUES ($1, $2, 1, 'scheduled_auto')", [runId, taskId]);
    await client.query("UPDATE tasks SET status = 'running' WHERE id = $1", [taskId]);
    await client.query("UPDATE tasks SET status = 'succeeded' WHERE id = $1", [taskId]);

    expect(await pendingReports(taskId)).toEqual([{ status: "succeeded", run_id: runId }]);
  });

  it("never passes off an earlier run's reply as the reported run's result", async () => {
    await client.query("DELETE FROM project_master_reports");
    const taskId = await createTask();
    await client.query("INSERT INTO project_master_listeners(task_id, master_task_id) VALUES ($1, $2)", [taskId, masterTaskId]);
    await finishRun(taskId, "succeeded", "Old answer.");
    await claimPendingMasterReports(client as unknown as PoolClient, masterTaskId, null);
    await finishRun(taskId, "failed", null);

    const [report] = await claimPendingMasterReports(client as unknown as PoolClient, masterTaskId, null);

    expect(report).toEqual(expect.objectContaining({ status: "failed", latest_response: null }));
  });

  it("hands each member's run only the reports on work that member asked for", async () => {
    await client.query("DELETE FROM project_master_reports");
    const [alice, bob] = [randomUUID(), randomUUID()];
    await client.query("INSERT INTO users(id) VALUES ($1), ($2)", [alice, bob]);
    const aliceTask = await createTask();
    const bobTask = await createTask();
    await client.query(
      "INSERT INTO project_master_listeners(task_id, master_task_id, requested_by_user_id) VALUES ($1, $3, $4), ($2, $3, $5)",
      [aliceTask, bobTask, masterTaskId, alice, bob]
    );
    await finishRun(aliceTask, "succeeded", "Alice's result.");
    await finishRun(bobTask, "succeeded", "Bob's result.");

    const forAlice = await claimPendingMasterReports(client as unknown as PoolClient, masterTaskId, alice);
    const forBob = await claimPendingMasterReports(client as unknown as PoolClient, masterTaskId, bob);

    expect(forAlice.map((report) => report.task_id)).toEqual([aliceTask]);
    expect(forBob.map((report) => report.task_id)).toEqual([bobTask]);
  });
});
