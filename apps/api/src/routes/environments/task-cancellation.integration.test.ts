import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ client: null as Client | null }));
vi.mock("../../lib/db.js", () => ({
  query: (sql: string, values?: unknown[]) => state.client!.query(sql, values),
  withTransaction: async (callback: (client: Client) => Promise<unknown>) => {
    const client = state.client!;
    await client.query("BEGIN");
    try { const result = await callback(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
  }
}));
vi.mock("../../services/task-search/query.js", () => ({ searchProjectTasks: vi.fn() }));
vi.mock("../../services/tasks/task-list.js", () => ({ listProjectTasks: vi.fn() }));
vi.mock("../../services/tasks/task-cleanup.js", () => ({ emptyEnvironmentTrash: vi.fn(), resolveTaskCleanupExpirationDays: vi.fn(), runEnvironmentTaskCleanup: vi.fn() }));
vi.mock("../../services/runtime/events.js", () => ({ appendTaskEvent: vi.fn() }));
vi.mock("../../services/tasks/unclaimed-local-run-cancellation.js", () => ({ cancelUnclaimedLocalRunsInTx: async () => [] }));

import { registerEnvironmentTaskRoutes } from "./task-routes.js";

describe.skipIf(!process.env.TEST_CONTEXT_DATABASE_URL)("project bulk cancellation integration", () => {
  let schema: string;
  const projectId = "11111111-1111-4111-8111-111111111111";
  const rootId = "22222222-2222-4222-8222-222222222222";
  const laneId = "33333333-3333-4333-8333-333333333333";
  const interruptId = "44444444-4444-4444-8444-444444444444";

  beforeEach(async () => {
    const client = new Client({ connectionString: process.env.TEST_CONTEXT_DATABASE_URL });
    await client.connect(); state.client = client;
    schema = `audit_cancel_${randomUUID().replaceAll("-", "")}`;
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`
      CREATE TABLE environments (id uuid PRIMARY KEY, workspace_id text);
      CREATE TABLE workspace_members (workspace_id text, user_id text);
      CREATE TABLE tasks (
        id uuid PRIMARY KEY, environment_id uuid, workspace_id text, parent_task_id uuid, workflow_parent_task_id uuid,
        workflow_type text, status text, cancellation_requested boolean DEFAULT false, resume_after_interrupt boolean DEFAULT false, updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE task_schedules (task_id uuid, schedule_state text, next_run_at timestamptz, run_deadline_at timestamptz, pending_run boolean, cancelled_at timestamptz, updated_at timestamptz);
      CREATE TABLE task_run_dispatches (task_id uuid, queue_state text, eligible_at timestamptz, updated_at timestamptz);
      INSERT INTO environments VALUES ('${projectId}', 'workspace');
      INSERT INTO workspace_members VALUES ('workspace', 'user');
      INSERT INTO tasks (id, environment_id, workspace_id, workflow_type, status) VALUES ('${rootId}', '${projectId}', 'workspace', 'agent_swarm', 'running');
      INSERT INTO tasks (id, environment_id, workspace_id, workflow_type, workflow_parent_task_id, status) VALUES ('${laneId}', '${projectId}', 'workspace', 'agent_swarm', '${rootId}', 'running');
      INSERT INTO tasks (id, environment_id, workspace_id, status, cancellation_requested, resume_after_interrupt) VALUES ('${interruptId}', '${projectId}', 'workspace', 'queued', true, true);
      INSERT INTO task_run_dispatches VALUES ('${interruptId}', 'pending', now() + interval '1 day', now());
    `);
  });
  afterEach(async () => {
    if (!state.client) return;
    await state.client.query(`DROP SCHEMA ${schema} CASCADE`);
    await state.client.end(); state.client = null;
  });

  it("cancels swarm descendants and overrides an interrupt, making its delayed dispatch eligible", async () => {
    const app = Fastify();
    app.decorate("authenticate", async (request) => { request.user = { id: "user", email: "user@example.com" }; });
    await registerEnvironmentTaskRoutes(app);
    const response = await app.inject({ method: "POST", url: `/api/projects/${projectId}/tasks/cancel`, payload: {} });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ cancelledCount: 2 });
    const tasks = (await state.client!.query("SELECT cancellation_requested, resume_after_interrupt FROM tasks")).rows;
    expect(tasks).toHaveLength(3);
    for (const task of tasks) expect(task).toEqual({ cancellation_requested: true, resume_after_interrupt: false });
    expect((await state.client!.query("SELECT eligible_at <= now() AS eligible FROM task_run_dispatches")).rows).toEqual([{ eligible: true }]);
    await app.close();
  });
});
