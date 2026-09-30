import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("../../../lib/queue.js", () => ({
  taskQueue: {
    add: vi.fn()
  }
}));

vi.mock("../../billing/entitlements.js", () => ({
  getPromptEntitlementStatus: vi.fn(),
  recordPromptUsageIfRequired: vi.fn()
}));

vi.mock("../../workspaces/memory-synthesis-events.js", () => ({
  publishMemorySynthesisEvent: vi.fn(async () => undefined)
}));

import { query, withTransaction } from "../../../lib/db.js";
import { taskQueue } from "../../../lib/queue.js";
import {
  getPromptEntitlementStatus,
  recordPromptUsageIfRequired
} from "../../billing/entitlements.js";
import { appendTaskUserMessageAndEnqueue, createTaskWithInitialMessage, replaceTaskMessageAndEnqueue } from "./index.js";

type MockQuery = ReturnType<typeof vi.fn>;

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

function createClient(handler: (sql: string, params: unknown[]) => QueryResult<any> | Promise<QueryResult<any>>) {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SET task_history_last_active_at")) {
        return buildRowsResult([]);
      }
      return handler(sql, params);
    })
  };
}

function buildExistingCreateSnapshot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    task_id: "task-dup",
    workspace_id: "workspace-1",
    environment_id: "environment-1",
    source: "github",
    initiator_user_id: "user-1",
    connector_context_id: null,
    user_message_id: "message-existing",
    run_id: "run-existing",
    ...overrides
  };
}

function expectDispatchPayload(queryMock: MockQuery): { sql: string; params: unknown[]; payload: Record<string, unknown> } {
  const dispatchCall = queryMock.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO task_run_dispatches"));
  expect(dispatchCall).toBeTruthy();
  const sql = String(dispatchCall![0]);
  const params = (dispatchCall![1] ?? []) as unknown[];
  const payload = JSON.parse(String(params[5] ?? "{}")) as Record<string, unknown>;
  return { sql, params, payload };
}

describe("createTaskWithInitialMessage", () => {
  const mockedWithTransaction = vi.mocked(withTransaction);
  const mockedQuery = vi.mocked(query);
  const mockedQueueAdd = vi.mocked(taskQueue.add);
  const mockedGetPromptEntitlementStatus = vi.mocked(getPromptEntitlementStatus);
  const mockedRecordPromptUsageIfRequired = vi.mocked(recordPromptUsageIfRequired);
  const allowedEntitlement = {
    mode: "free" as const,
    allowed: true,
    reason: null,
    freeMessageLimit: 10,
    freeMessagesUsed: 0,
    monthlyWeightedTokenLimit: 0,
    monthlyWeightedTokenUsed: 0,
  subscriptionUsageLimitExceeded: false
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedQueueAdd.mockResolvedValue(undefined as never);
    mockedGetPromptEntitlementStatus.mockResolvedValue(allowedEntitlement);
    mockedRecordPromptUsageIfRequired.mockResolvedValue(undefined);
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue(buildRowsResult([]));
  });

  it("uses selectionUserId for the initial branch selection and queued run actor", async () => {
    const client = createClient((sql, params) => {
      if (sql.includes("INSERT INTO tasks (")) {
        return buildRowsResult([]);
      }
      if (sql.includes("INSERT INTO task_messages")) {
        return buildRowsResult([{ id: "message-1", created_at: "2026-03-21T00:00:00.000Z" }]);
      }
      if (sql.includes("INSERT INTO task_branch_selections")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT id") && sql.includes("FROM tasks") && sql.includes("FOR UPDATE")) {
        return buildRowsResult([{ id: "task-1" }]);
      }
      if (sql.includes("SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no")) {
        return buildRowsResult([{ attempt_no: 1 }]);
      }
      if (sql.includes("INSERT INTO task_runs")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SET status = 'queued'")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT is_super_admin")) {
        return buildRowsResult([{ is_super_admin: false }]);
      }
      if (sql.includes("INSERT INTO task_run_dispatches")) {
        return buildRowsResult([]);
      }

      throw new Error(`Unhandled query in test: ${sql}`);
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    const created = await createTaskWithInitialMessage({
      taskId: "task-1",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      source: "github",
      selectionUserId: "admin-1",
      connectorContextId: "thread-1",
      title: "New Task",
      message: "hello from connector"
    });

    expect(created).toMatchObject({
      taskId: "task-1",
      userMessageId: "message-1"
    });
    expect(mockedGetPromptEntitlementStatus).toHaveBeenCalledWith("admin-1");
    expect(mockedRecordPromptUsageIfRequired).toHaveBeenCalledWith({
      userId: "admin-1",
      mode: "free",
      taskId: "task-1",
      taskMessageId: "message-1"
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO task_branch_selections"),
      ["task-1", "admin-1", "message-1"]
    );

    const dispatch = expectDispatchPayload(client.query);
    expect(dispatch.params).toEqual(expect.arrayContaining([
      created.runId,
      "task-1",
      "workspace-1",
      "environment-1",
      "interactive_new"
    ]));
    expect(dispatch.payload).toMatchObject({
      taskId: "task-1",
      selectionUserId: "admin-1",
      branchMessageId: "message-1",
      triggerSource: "github"
    });
    expect(mockedQueueAdd).not.toHaveBeenCalled();
  });

  it("stores max step overrides, waiting preferences, and recurring metadata when provided", async () => {
    const client = createClient((sql) => {
      if (sql.includes("INSERT INTO tasks (")) {
        return buildRowsResult([]);
      }
      if (sql.includes("INSERT INTO task_messages")) {
        return buildRowsResult([{ id: "message-2", created_at: "2026-03-21T00:00:00.000Z" }]);
      }
      if (sql.includes("INSERT INTO task_schedules")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT id") && sql.includes("FROM tasks") && sql.includes("FOR UPDATE")) {
        return buildRowsResult([{ id: "task-2" }]);
      }
      if (sql.includes("SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no")) {
        return buildRowsResult([{ attempt_no: 1 }]);
      }
      if (sql.includes("INSERT INTO task_runs")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SET status = 'queued'")) {
        return buildRowsResult([]);
      }
      if (sql.includes("INSERT INTO task_run_dispatches")) {
        return buildRowsResult([]);
      }

      throw new Error(`Unhandled query in test: ${sql}`);
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    await createTaskWithInitialMessage({
      taskId: "task-2",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      source: "web",
      title: "Timed Task",
      message: "watch this for thirty minutes",
      defaultTimezone: "UTC",
      maxStepsOverride: 42,
      allowWaiting: false,
      schedule: {
        mode: "infinite",
        repeat: null,
        timezone: "UTC",
        nextRunAt: null,
        enabledTools: {
          webSearch: true
        },
        createdByUserId: "user-1",
        runTimeoutSeconds: 1800,
        runDeadlineAt: "2026-03-12T06:30:00.000Z"
      },
      initialRunMode: "infinite_auto",
      initialRunToolOptionsOverride: {
        webSearch: true
      }
    });

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("allow_waiting"),
      expect.arrayContaining(["task-2", 42, false])
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO task_schedules"),
      expect.arrayContaining(["task-2", "infinite", "UTC", 1800, "2026-03-12T06:30:00.000Z"])
    );

    const dispatch = expectDispatchPayload(client.query);
    expect(dispatch.params[4]).toBe("background");
    expect(dispatch.payload).toMatchObject({
      taskId: "task-2",
      mode: "infinite_auto",
      toolOptionsOverride: {
        webSearch: true
      }
    });
    expect(mockedGetPromptEntitlementStatus).not.toHaveBeenCalled();
    expect(mockedRecordPromptUsageIfRequired).not.toHaveBeenCalled();
    expect(mockedQueueAdd).not.toHaveBeenCalled();
  });

  it("reuses an existing matching explicit task id instead of failing on duplicate inserts", async () => {
    mockedQuery.mockResolvedValue(buildRowsResult([
      buildExistingCreateSnapshot()
    ]));

    const created = await createTaskWithInitialMessage({
      taskId: "task-dup",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      source: "github",
      selectionUserId: "user-1",
      title: "Existing task",
      message: "hello from connector"
    });

    expect(created).toEqual({
      taskId: "task-dup",
      runId: "run-existing",
      userMessageId: "message-existing",
      reusedExisting: true
    });
    expect(mockedWithTransaction).not.toHaveBeenCalled();
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("LEFT JOIN LATERAL"),
      ["task-dup"]
    );
    expect(mockedGetPromptEntitlementStatus).toHaveBeenCalledWith("user-1");
    expect(mockedRecordPromptUsageIfRequired).not.toHaveBeenCalled();
    expect(mockedQueueAdd).not.toHaveBeenCalled();
  });

  it("reuses an existing explicit task id even when non-identity fields differ", async () => {
    mockedQuery.mockResolvedValue(buildRowsResult([
      buildExistingCreateSnapshot({
        source: "web",
        run_id: "run-existing-web"
      })
    ]));

    const created = await createTaskWithInitialMessage({
      taskId: "task-dup",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      source: "web",
      initiatorUserId: "user-1",
      title: "Changed title",
      message: "completely different prompt",
      defaultTimezone: "Asia/Singapore",
      maxStepsOverride: 99,
      allowWaiting: false,
      initialRunMode: "default"
    });

    expect(created).toEqual({
      taskId: "task-dup",
      runId: "run-existing-web",
      userMessageId: "message-existing",
      reusedExisting: true
    });
    expect(mockedWithTransaction).not.toHaveBeenCalled();
  });

  it("creates the initial dispatched run exactly once when reusing an existing explicit task without a run", async () => {
    const firstSnapshot = buildExistingCreateSnapshot({ run_id: null });
    mockedQuery.mockResolvedValueOnce(buildRowsResult([firstSnapshot]));

    const client = createClient((sql) => {
      if (sql.includes("SELECT id") && sql.includes("FROM tasks") && sql.includes("FOR UPDATE")) {
        return buildRowsResult([{ id: "task-dup" }]);
      }
      if (sql.includes("SELECT id, attempt_no") && sql.includes("FROM task_runs")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no")) {
        return buildRowsResult([{ attempt_no: 1 }]);
      }
      if (sql.includes("INSERT INTO task_runs")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SET status = 'queued'")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT is_super_admin")) {
        return buildRowsResult([{ is_super_admin: false }]);
      }
      if (sql.includes("INSERT INTO task_run_dispatches")) {
        return buildRowsResult([]);
      }

      throw new Error(`Unhandled query in duplicate no-run test: ${sql}`);
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    const created = await createTaskWithInitialMessage({
      taskId: "task-dup",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      source: "github",
      selectionUserId: "user-1",
      title: "Existing task",
      message: "hello from connector"
    });

    expect(created).toMatchObject({
      taskId: "task-dup",
      userMessageId: "message-existing",
      reusedExisting: true
    });
    expect(client.query).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO tasks ("), expect.anything());

    const dispatch = expectDispatchPayload(client.query);
    expect(dispatch.params).toEqual(expect.arrayContaining([
      created.runId,
      "task-dup",
      "workspace-1",
      "environment-1",
      "interactive_new"
    ]));
  });

  it("restarts timed chat follow-ups as infinite auto runs with a fresh deadline", async () => {
    const client = createClient((sql) => {
      if (sql.includes("INSERT INTO task_messages")) {
        return buildRowsResult([{ id: "message-3", created_at: "2026-03-21T00:00:00.000Z" }]);
      }
      if (sql.includes("SELECT workflow_type, workflow_parent_task_id") && sql.includes("FOR UPDATE")) {
        return buildRowsResult([{ workflow_type: null, workflow_parent_task_id: null }]);
      }
      if (sql.includes("SET time_limit_deadline_at = CASE")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT t.workflow_type")) {
        return buildRowsResult([{ workflow_type: null, workflow_internal_role: null, workflow_parent_task_id: null, status: "awaiting_input" }]);
      }
      if (sql.includes("SELECT mode, run_timeout_seconds") && sql.includes("FROM task_schedules")) {
        return buildRowsResult([{ mode: "infinite", run_timeout_seconds: 1800 }]);
      }
      if (sql.includes("run_deadline_at = now() + make_interval(secs => run_timeout_seconds)")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT status") && sql.includes("FROM tasks") && sql.includes("FOR UPDATE") && !sql.includes("workflow_type")) {
        return buildRowsResult([{ status: "awaiting_input" }]);
      }
      if (sql.includes("SELECT id") && sql.includes("FROM tasks") && sql.includes("FOR UPDATE")) {
        return buildRowsResult([{ id: "task-3" }]);
      }
      if (sql.includes("SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no")) {
        return buildRowsResult([{ attempt_no: 4 }]);
      }
      if (sql.includes("INSERT INTO task_runs")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SET status = 'queued'")) {
        return buildRowsResult([]);
      }
      if (sql.includes("INSERT INTO task_run_dispatches")) {
        return buildRowsResult([]);
      }

      throw new Error(`Unhandled query in test: ${sql}`);
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    const result = await appendTaskUserMessageAndEnqueue({
      taskId: "task-3",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      triggerSource: "web",
      message: "keep watching",
      parentMessageId: "parent-1"
    });

    expect(result).toMatchObject({
      taskId: "task-3",
      mode: "enqueued",
      messageId: "message-3",
      activeLeafMessageId: "message-3"
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("FOR UPDATE OF t"),
      ["task-3"]
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("run_deadline_at = now() + make_interval(secs => run_timeout_seconds)"),
      ["task-3"]
    );

    const dispatch = expectDispatchPayload(client.query);
    expect(dispatch.payload).toMatchObject({
      taskId: "task-3",
      mode: "infinite_auto",
      branchMessageId: "message-3"
    });
    expect(mockedQueueAdd).not.toHaveBeenCalled();
  });

  it("enqueues a fresh run when a queued task has no unfinished run to interrupt", async () => {
    const client = createClient((sql) => {
      if (sql.includes("INSERT INTO task_messages")) {
        return buildRowsResult([{ id: "message-4", created_at: "2026-03-21T00:00:00.000Z" }]);
      }
      if (sql.includes("SET initiator_user_id = $2")) {
        return buildRowsResult([]);
      }
      if (sql.includes("INSERT INTO task_branch_selections")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT workflow_type, workflow_parent_task_id") && sql.includes("FOR UPDATE")) {
        return buildRowsResult([{ workflow_type: null, workflow_parent_task_id: null }]);
      }
      if (sql.includes("SET time_limit_deadline_at = CASE")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT t.workflow_type")) {
        return buildRowsResult([{ workflow_type: null, workflow_internal_role: null, workflow_parent_task_id: null, status: "queued" }]);
      }
      if (sql.includes("SELECT mode, run_timeout_seconds") && sql.includes("FROM task_schedules")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT status") && sql.includes("FROM tasks") && sql.includes("FOR UPDATE") && !sql.includes("workflow_type")) {
        return buildRowsResult([{ status: "queued" }]);
      }
      if (sql.includes("SELECT id") && sql.includes("FROM task_runs") && sql.includes("ended_at IS NULL")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT id") && sql.includes("FROM tasks") && sql.includes("FOR UPDATE")) {
        return buildRowsResult([{ id: "task-4" }]);
      }
      if (sql.includes("SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no")) {
        return buildRowsResult([{ attempt_no: 9 }]);
      }
      if (sql.includes("SELECT is_super_admin")) {
        return buildRowsResult([{ is_super_admin: false }]);
      }
      if (sql.includes("INSERT INTO task_runs")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SET status = 'queued'")) {
        return buildRowsResult([]);
      }
      if (sql.includes("INSERT INTO task_run_dispatches")) {
        return buildRowsResult([]);
      }

      throw new Error(`Unhandled query in test: ${sql}`);
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    const result = await appendTaskUserMessageAndEnqueue({
      taskId: "task-4",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      triggerSource: "discord",
      message: "please continue",
      userId: "user-1",
      parentMessageId: "parent-queued",
      interruptQueued: true
    });

    expect(result).toMatchObject({
      taskId: "task-4",
      mode: "enqueued",
      messageId: "message-4",
      activeLeafMessageId: "message-4"
    });

    const dispatch = expectDispatchPayload(client.query);
    expect(dispatch.payload).toMatchObject({
      taskId: "task-4",
      branchMessageId: "message-4",
      triggerSource: "discord"
    });
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("cancellation_requested = true"),
      expect.anything()
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("SET initiator_user_id = $2"),
      ["task-4", "user-1"]
    );
    expect(mockedGetPromptEntitlementStatus).toHaveBeenCalledWith("user-1");
    expect(mockedRecordPromptUsageIfRequired).toHaveBeenCalledWith({
      userId: "user-1",
      mode: "free",
      taskId: "task-4",
      taskMessageId: "message-4"
    });
    expect(mockedQueueAdd).not.toHaveBeenCalled();
  });

  it("rejects connector follow-ups without an accountable user", async () => {
    await expect(
      appendTaskUserMessageAndEnqueue({
        taskId: "task-missing-user",
        workspaceId: "workspace-1",
        environmentId: "environment-1",
        triggerSource: "discord",
        message: "please continue"
      })
    ).rejects.toThrow("execution requires an accountable user");

    expect(mockedWithTransaction).not.toHaveBeenCalled();
    expect(mockedGetPromptEntitlementStatus).not.toHaveBeenCalled();
    expect(mockedRecordPromptUsageIfRequired).not.toHaveBeenCalled();
  });

  it("reactivates completed agent swarm follow-ups before dispatching, even when the stale parent status is queued", async () => {
    const client = createClient((sql) => {
      if (sql.includes("INSERT INTO task_messages")) {
        return buildRowsResult([{ id: "message-5", created_at: "2026-03-21T00:00:00.000Z" }]);
      }
      if (sql.includes("SELECT workflow_type, workflow_parent_task_id") && sql.includes("FOR UPDATE")) {
        return buildRowsResult([{ workflow_type: "agent_swarm", workflow_parent_task_id: null }]);
      }
      if (sql.includes("SET time_limit_deadline_at = CASE")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT t.workflow_type")) {
        return buildRowsResult([{
          workflow_type: "agent_swarm",
          workflow_internal_role: null,
          workflow_parent_task_id: null,
          status: "queued"
        }]);
      }
      if (sql.includes("SELECT phase, state_json")) {
        return buildRowsResult([{
          phase: "completed",
          state_json: {
            cycleStartMessageNo: 12,
            leaderKickoffMessageNo: 21,
            workersStartedAt: "2026-03-18T00:00:00.000Z"
          }
        }]);
      }
      if (sql.includes("SELECT COALESCE(MAX(message_no), 0)::int AS latest_message_no")) {
        return buildRowsResult([{ latest_message_no: 33 }]);
      }
      if (sql.includes("UPDATE task_workflows")) {
        return buildRowsResult([]);
      }
      if (sql.includes("UPDATE task_runs tr")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SET status = 'awaiting_input'")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT status") && sql.includes("FROM tasks") && sql.includes("FOR UPDATE") && !sql.includes("workflow_type")) {
        return buildRowsResult([{ status: "awaiting_input" }]);
      }
      if (sql.includes("SELECT id") && sql.includes("FROM tasks") && sql.includes("FOR UPDATE")) {
        return buildRowsResult([{ id: "task-5" }]);
      }
      if (sql.includes("SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no")) {
        return buildRowsResult([{ attempt_no: 7 }]);
      }
      if (sql.includes("INSERT INTO task_runs")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SET status = 'queued'")) {
        return buildRowsResult([]);
      }
      if (sql.includes("INSERT INTO task_run_dispatches")) {
        return buildRowsResult([]);
      }

      throw new Error(`Unhandled query in test: ${sql}`);
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    const result = await appendTaskUserMessageAndEnqueue({
      taskId: "task-5",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      triggerSource: "web",
      message: "continue the swarm",
      parentMessageId: "parent-completed-swarm",
      interruptQueued: true
    });

    expect(result).toMatchObject({
      taskId: "task-5",
      mode: "enqueued",
      messageId: "message-5",
      activeLeafMessageId: "message-5"
    });

    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("workflow_parent_task_id = $1"),
      ["task-5"]
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE task_runs tr"),
      ["task-5"]
    );
    expect(client.query).not.toHaveBeenCalledWith(
      expect.stringContaining("cancellation_requested = true"),
      expect.anything()
    );

    const dispatch = expectDispatchPayload(client.query);
    expect(dispatch.payload).toMatchObject({
      taskId: "task-5",
      mode: "agent_swarm_leader",
      branchMessageId: "message-5"
    });
    expect(mockedQueueAdd).not.toHaveBeenCalled();
  });

  it("retries completed agent swarm branches by reactivating the workflow and enqueuing the leader mode", async () => {
    const client = createClient((sql) => {
      if (sql.includes("INSERT INTO task_messages")) {
        return buildRowsResult([{ id: "message-6", created_at: "2026-03-21T00:00:00.000Z" }]);
      }
      if (sql.includes("SELECT workflow_type, workflow_parent_task_id") && sql.includes("FOR UPDATE")) {
        return buildRowsResult([{ workflow_type: "agent_swarm", workflow_parent_task_id: null }]);
      }
      if (sql.includes("SET time_limit_deadline_at = CASE")) {
        return buildRowsResult([]);
      }
      if (sql.includes("INSERT INTO task_message_revisions")) {
        return buildRowsResult([]);
      }
      if (sql.includes("INSERT INTO task_branch_selections")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT t.workflow_type")) {
        return buildRowsResult([{
          workflow_type: "agent_swarm",
          workflow_internal_role: "leader",
          workflow_parent_task_id: null,
          status: "queued"
        }]);
      }
      if (sql.includes("SELECT phase, state_json")) {
        return buildRowsResult([{
          phase: "completed",
          state_json: {
            cycleStartMessageNo: 12,
            leaderKickoffMessageNo: 21,
            workersStartedAt: "2026-03-18T00:00:00.000Z"
          }
        }]);
      }
      if (sql.includes("SELECT COALESCE(MAX(message_no), 0)::int AS latest_message_no")) {
        return buildRowsResult([{ latest_message_no: 33 }]);
      }
      if (sql.includes("UPDATE task_workflows")) {
        return buildRowsResult([]);
      }
      if (sql.includes("UPDATE task_runs tr")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SET status = 'awaiting_input'")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT status") && sql.includes("FROM tasks") && sql.includes("FOR UPDATE") && !sql.includes("workflow_type")) {
        return buildRowsResult([{ status: "awaiting_input" }]);
      }
      if (sql.includes("SELECT id") && sql.includes("FROM tasks") && sql.includes("FOR UPDATE")) {
        return buildRowsResult([{ id: "task-6" }]);
      }
      if (sql.includes("SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no")) {
        return buildRowsResult([{ attempt_no: 8 }]);
      }
      if (sql.includes("INSERT INTO task_runs")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SET status = 'queued'")) {
        return buildRowsResult([]);
      }
      if (sql.includes("SELECT is_super_admin")) {
        return buildRowsResult([{ is_super_admin: false }]);
      }
      if (sql.includes("INSERT INTO task_run_dispatches")) {
        return buildRowsResult([]);
      }

      throw new Error(`Unhandled query in test: ${sql}`);
    });
    mockedWithTransaction.mockImplementation(async (callback) => callback(client as never));

    const result = await replaceTaskMessageAndEnqueue({
      taskId: "task-6",
      workspaceId: "workspace-1",
      environmentId: "environment-1",
      triggerSource: "web",
      sourceMessageId: "source-message-1",
      parentMessageId: "parent-1",
      oldContent: { text: "old prompt" },
      nextContent: { text: "retry prompt" },
      userId: "user-1",
      interruptQueued: true
    });

    expect(result).toMatchObject({
      taskId: "task-6",
      mode: "enqueued",
      messageId: "message-6",
      activeLeafMessageId: "message-6"
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO task_message_revisions"),
      [
        "task-6",
        "source-message-1",
        "user-1",
        JSON.stringify({ text: "old prompt" }),
        JSON.stringify({ text: "retry prompt" })
      ]
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE task_runs tr"),
      ["task-6"]
    );

    const dispatch = expectDispatchPayload(client.query);
    expect(dispatch.payload).toMatchObject({
      taskId: "task-6",
      mode: "agent_swarm_leader",
      branchMessageId: "message-6",
      selectionUserId: "user-1"
    });
    expect(mockedQueueAdd).not.toHaveBeenCalled();
  });
});
