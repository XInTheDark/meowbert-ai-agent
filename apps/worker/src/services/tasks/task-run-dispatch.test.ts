import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskExecutionJob } from "@meowbert/shared";

vi.mock("../../lib/config.js", () => ({
  config: {
    limits: {
      defaultTaskConcurrencyPerEnv: 1,
      maxConcurrentTasksWorkspace: 2
    }
  }
}));

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  pool: {
    connect: vi.fn()
  }
}));

vi.mock("../../lib/queue.js", () => ({
  taskQueue: {
    add: vi.fn()
  }
}));

vi.mock("../runtime/debug-task-events.js", () => ({
  createTaskDebugLogger: vi.fn(() => ({
    log: vi.fn(async () => {})
  }))
}));

import { query } from "../../lib/db.js";
import { taskQueue } from "../../lib/queue.js";
import { runTaskRunDispatchOnce } from "./task-run-dispatch.js";

function buildRowsResult<Row extends Record<string, unknown>>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

function buildPayload(input: { taskId: string; runId: string; workspaceId: string; environmentId: string }): TaskExecutionJob {
  return {
    taskId: input.taskId,
    runId: input.runId,
    workspaceId: input.workspaceId,
    environmentId: input.environmentId,
    triggerSource: "web",
    mode: "default"
  };
}

describe("runTaskRunDispatchOnce", () => {
  const mockedQuery = vi.mocked(query);
  const mockedQueueAdd = vi.mocked(taskQueue.add);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedQueueAdd.mockResolvedValue(undefined as never);
  });

  it("prefers the least-loaded workspace before task urgency and applies aged-background priority", async () => {
    const claimedPayload = buildPayload({
      taskId: "task-b",
      runId: "run-b",
      workspaceId: "workspace-b",
      environmentId: "env-b"
    });

    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT EXISTS")) {
        return buildRowsResult([{ exists: true }]);
      }
      if (sql.includes("SELECT task_scheduler_json")) {
        return buildRowsResult([{
          task_scheduler_json: {
            defaultEnvironmentConcurrency: 1,
            maxWorkspaceConcurrency: 2,
            maxQueuedAheadPerWorkspace: 1,
            backgroundAgingMinutes: 15
          }
        }]);
      }
      if (sql.includes("WITH ranked_pending AS")) {
        return buildRowsResult([
          {
            run_id: "run-a",
            task_id: "task-a",
            workspace_id: "workspace-a",
            environment_id: "env-a",
            dispatch_class: "admin_interactive",
            payload_json: buildPayload({ taskId: "task-a", runId: "run-a", workspaceId: "workspace-a", environmentId: "env-a" }),
            queued_at: "2026-03-21T00:05:00.000Z",
            effective_rank: 1,
            workspace_rank: 1
          },
          {
            run_id: "run-b",
            task_id: "task-b",
            workspace_id: "workspace-b",
            environment_id: "env-b",
            dispatch_class: "background",
            payload_json: claimedPayload,
            queued_at: "2026-03-21T00:00:00.000Z",
            effective_rank: 3,
            workspace_rank: 1
          }
        ]);
      }
      if (sql.includes("GROUP BY d.workspace_id")) {
        return buildRowsResult([
          { workspace_id: "workspace-a", in_use_count: 1, admitted_count: 0 },
          { workspace_id: "workspace-b", in_use_count: 0, admitted_count: 0 }
        ]);
      }
      if (sql.includes("GROUP BY d.environment_id")) {
        return buildRowsResult([
          { environment_id: "env-a", in_use_count: 0 },
          { environment_id: "env-b", in_use_count: 0 }
        ]);
      }
      if (sql.includes("queue_state = 'admitted'")) {
        return buildRowsResult([{
          run_id: "run-b",
          task_id: "task-b",
          workspace_id: "workspace-b",
          environment_id: "env-b",
          dispatch_class: "background",
          queue_state: "admitted",
          payload_json: claimedPayload,
          eligible_at: "2026-03-21T00:00:00.000Z",
          priority_actor_user_id: null,
          priority_actor_is_super_admin: false,
          queued_at: "2026-03-21T00:00:00.000Z",
          admitted_at: "2026-03-21T00:20:00.000Z",
          started_at: null,
          finished_at: null
        }]);
      }

      throw new Error(`Unhandled query in test: ${sql}`);
    });

    const admittedCount = await runTaskRunDispatchOnce();

    expect(admittedCount).toBe(2);
    expect(mockedQueueAdd).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("task-task-b-run-run-b"),
      claimedPayload,
      expect.objectContaining({
        priority: 3,
        attempts: 1
      })
    );
  });

  it("picks the next eligible task inside a workspace when the first candidate's environment is full", async () => {
    const claimedPayload = buildPayload({
      taskId: "task-a2",
      runId: "run-a2",
      workspaceId: "workspace-a",
      environmentId: "env-c"
    });

    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT EXISTS")) {
        return buildRowsResult([{ exists: true }]);
      }
      if (sql.includes("SELECT task_scheduler_json")) {
        return buildRowsResult([{
          task_scheduler_json: {
            defaultEnvironmentConcurrency: 1,
            maxWorkspaceConcurrency: 2,
            maxQueuedAheadPerWorkspace: 1,
            backgroundAgingMinutes: 15
          }
        }]);
      }
      if (sql.includes("WITH ranked_pending AS")) {
        return buildRowsResult([
          {
            run_id: "run-a1",
            task_id: "task-a1",
            workspace_id: "workspace-a",
            environment_id: "env-a",
            dispatch_class: "interactive_followup",
            payload_json: buildPayload({ taskId: "task-a1", runId: "run-a1", workspaceId: "workspace-a", environmentId: "env-a" }),
            queued_at: "2026-03-21T00:03:00.000Z",
            effective_rank: 2,
            workspace_rank: 1
          },
          {
            run_id: "run-a2",
            task_id: "task-a2",
            workspace_id: "workspace-a",
            environment_id: "env-c",
            dispatch_class: "interactive_new",
            payload_json: claimedPayload,
            queued_at: "2026-03-21T00:01:00.000Z",
            effective_rank: 3,
            workspace_rank: 2
          },
          {
            run_id: "run-b",
            task_id: "task-b",
            workspace_id: "workspace-b",
            environment_id: "env-b",
            dispatch_class: "interactive_new",
            payload_json: buildPayload({ taskId: "task-b", runId: "run-b", workspaceId: "workspace-b", environmentId: "env-b" }),
            queued_at: "2026-03-21T00:02:00.000Z",
            effective_rank: 3,
            workspace_rank: 1
          }
        ]);
      }
      if (sql.includes("GROUP BY d.workspace_id")) {
        return buildRowsResult([
          { workspace_id: "workspace-a", in_use_count: 0, admitted_count: 0 },
          { workspace_id: "workspace-b", in_use_count: 0, admitted_count: 0 }
        ]);
      }
      if (sql.includes("GROUP BY d.environment_id")) {
        return buildRowsResult([
          { environment_id: "env-a", in_use_count: 1 },
          { environment_id: "env-b", in_use_count: 0 },
          { environment_id: "env-c", in_use_count: 0 }
        ]);
      }
      if (sql.includes("queue_state = 'admitted'")) {
        return buildRowsResult([{
          run_id: "run-a2",
          task_id: "task-a2",
          workspace_id: "workspace-a",
          environment_id: "env-c",
          dispatch_class: "interactive_new",
          queue_state: "admitted",
          payload_json: claimedPayload,
          eligible_at: "2026-03-21T00:00:00.000Z",
          priority_actor_user_id: null,
          priority_actor_is_super_admin: false,
          queued_at: "2026-03-21T00:01:00.000Z",
          admitted_at: "2026-03-21T00:20:00.000Z",
          started_at: null,
          finished_at: null
        }]);
      }

      throw new Error(`Unhandled query in test: ${sql}`);
    });

    const admittedCount = await runTaskRunDispatchOnce();

    expect(admittedCount).toBe(2);
    expect(mockedQueueAdd).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("task-task-a2-run-run-a2"),
      claimedPayload,
      expect.objectContaining({ priority: 3 })
    );
  });

  it("skips workspaces that are already at the configured max concurrent task cap", async () => {
    const claimedPayload = buildPayload({
      taskId: "task-b",
      runId: "run-b",
      workspaceId: "workspace-b",
      environmentId: "env-b"
    });

    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT EXISTS")) {
        return buildRowsResult([{ exists: true }]);
      }
      if (sql.includes("SELECT task_scheduler_json")) {
        return buildRowsResult([{
          task_scheduler_json: {
            defaultEnvironmentConcurrency: 1,
            maxWorkspaceConcurrency: 2,
            maxQueuedAheadPerWorkspace: 1,
            backgroundAgingMinutes: 15
          }
        }]);
      }
      if (sql.includes("WITH ranked_pending AS")) {
        return buildRowsResult([
          {
            run_id: "run-a",
            task_id: "task-a",
            workspace_id: "workspace-a",
            environment_id: "env-a",
            dispatch_class: "interactive_followup",
            payload_json: buildPayload({ taskId: "task-a", runId: "run-a", workspaceId: "workspace-a", environmentId: "env-a" }),
            queued_at: "2026-03-21T00:00:00.000Z",
            effective_rank: 2,
            workspace_rank: 1
          },
          {
            run_id: "run-b",
            task_id: "task-b",
            workspace_id: "workspace-b",
            environment_id: "env-b",
            dispatch_class: "interactive_new",
            payload_json: claimedPayload,
            queued_at: "2026-03-21T00:01:00.000Z",
            effective_rank: 3,
            workspace_rank: 1
          }
        ]);
      }
      if (sql.includes("GROUP BY d.workspace_id")) {
        return buildRowsResult([
          { workspace_id: "workspace-a", in_use_count: 2, admitted_count: 0 },
          { workspace_id: "workspace-b", in_use_count: 0, admitted_count: 0 }
        ]);
      }
      if (sql.includes("GROUP BY d.environment_id")) {
        return buildRowsResult([
          { environment_id: "env-a", in_use_count: 0 },
          { environment_id: "env-b", in_use_count: 0 }
        ]);
      }
      if (sql.includes("queue_state = 'admitted'")) {
        return buildRowsResult([{
          run_id: "run-b",
          task_id: "task-b",
          workspace_id: "workspace-b",
          environment_id: "env-b",
          dispatch_class: "interactive_new",
          queue_state: "admitted",
          payload_json: claimedPayload,
          eligible_at: "2026-03-21T00:00:00.000Z",
          priority_actor_user_id: null,
          priority_actor_is_super_admin: false,
          queued_at: "2026-03-21T00:01:00.000Z",
          admitted_at: "2026-03-21T00:20:00.000Z",
          started_at: null,
          finished_at: null
        }]);
      }

      throw new Error(`Unhandled query in test: ${sql}`);
    });

    const admittedCount = await runTaskRunDispatchOnce();

    expect(admittedCount).toBe(1);
    expect(mockedQueueAdd).toHaveBeenCalledWith(
      expect.stringContaining("task-task-b-run-run-b"),
      claimedPayload,
      expect.objectContaining({ priority: 3 })
    );
  });

  it("skips workspaces that already have the configured queued-ahead dispatch allowance", async () => {
    const claimedPayload = buildPayload({
      taskId: "task-b",
      runId: "run-b",
      workspaceId: "workspace-b",
      environmentId: "env-b"
    });

    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT EXISTS")) {
        return buildRowsResult([{ exists: true }]);
      }
      if (sql.includes("SELECT task_scheduler_json")) {
        return buildRowsResult([{
          task_scheduler_json: {
            defaultEnvironmentConcurrency: 1,
            maxWorkspaceConcurrency: 2,
            maxQueuedAheadPerWorkspace: 1,
            backgroundAgingMinutes: 15
          }
        }]);
      }
      if (sql.includes("WITH ranked_pending AS")) {
        return buildRowsResult([
          {
            run_id: "run-a",
            task_id: "task-a",
            workspace_id: "workspace-a",
            environment_id: "env-a",
            dispatch_class: "interactive_followup",
            payload_json: buildPayload({ taskId: "task-a", runId: "run-a", workspaceId: "workspace-a", environmentId: "env-a" }),
            queued_at: "2026-03-21T00:00:00.000Z",
            effective_rank: 2,
            workspace_rank: 1
          },
          {
            run_id: "run-b",
            task_id: "task-b",
            workspace_id: "workspace-b",
            environment_id: "env-b",
            dispatch_class: "interactive_new",
            payload_json: claimedPayload,
            queued_at: "2026-03-21T00:01:00.000Z",
            effective_rank: 3,
            workspace_rank: 1
          }
        ]);
      }
      if (sql.includes("GROUP BY d.workspace_id")) {
        return buildRowsResult([
          { workspace_id: "workspace-a", in_use_count: 0, admitted_count: 1 },
          { workspace_id: "workspace-b", in_use_count: 0, admitted_count: 0 }
        ]);
      }
      if (sql.includes("GROUP BY d.environment_id")) {
        return buildRowsResult([
          { environment_id: "env-a", in_use_count: 0 },
          { environment_id: "env-b", in_use_count: 0 }
        ]);
      }
      if (sql.includes("queue_state = 'admitted'")) {
        return buildRowsResult([{
          run_id: "run-b",
          task_id: "task-b",
          workspace_id: "workspace-b",
          environment_id: "env-b",
          dispatch_class: "interactive_new",
          queue_state: "admitted",
          payload_json: claimedPayload,
          eligible_at: "2026-03-21T00:00:00.000Z",
          priority_actor_user_id: null,
          priority_actor_is_super_admin: false,
          queued_at: "2026-03-21T00:01:00.000Z",
          admitted_at: "2026-03-21T00:20:00.000Z",
          started_at: null,
          finished_at: null
        }]);
      }

      throw new Error(`Unhandled query in test: ${sql}`);
    });

    const admittedCount = await runTaskRunDispatchOnce();

    expect(admittedCount).toBe(1);
    expect(mockedQueueAdd).toHaveBeenCalledWith(
      expect.stringContaining("task-task-b-run-run-b"),
      claimedPayload,
      expect.objectContaining({ priority: 3 })
    );
  });

  it("ignores stale admitted or running dispatch rows whose tasks are no longer active", async () => {
    const claimedPayload = buildPayload({
      taskId: "task-b",
      runId: "run-b",
      workspaceId: "workspace-b",
      environmentId: "env-b"
    });

    mockedQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT EXISTS")) {
        return buildRowsResult([{ exists: true }]);
      }
      if (sql.includes("SELECT task_scheduler_json")) {
        return buildRowsResult([{
          task_scheduler_json: {
            defaultEnvironmentConcurrency: 1,
            maxWorkspaceConcurrency: 2,
            maxQueuedAheadPerWorkspace: 1,
            backgroundAgingMinutes: 15
          }
        }]);
      }
      if (sql.includes("WITH ranked_pending AS")) {
        expect(sql).toContain("JOIN task_runs tr");
        expect(sql).toContain("tr.ended_at IS NULL");
        return buildRowsResult([
          {
            run_id: "run-b",
            task_id: "task-b",
            workspace_id: "workspace-b",
            environment_id: "env-b",
            dispatch_class: "interactive_new",
            payload_json: claimedPayload,
            queued_at: "2026-03-21T00:01:00.000Z",
            effective_rank: 3,
            workspace_rank: 1
          }
        ]);
      }
      if (sql.includes("GROUP BY d.workspace_id")) {
        expect(sql).toContain("JOIN task_runs tr");
        expect(sql).toContain("t.status IN ('queued', 'starting', 'running')");
        expect(sql).toContain("t.status = 'queued'");
        return buildRowsResult([
          { workspace_id: "workspace-b", in_use_count: 0, admitted_count: 0 }
        ]);
      }
      if (sql.includes("GROUP BY d.environment_id")) {
        expect(sql).toContain("JOIN task_runs tr");
        expect(sql).toContain("t.status IN ('queued', 'starting', 'running')");
        return buildRowsResult([
          { environment_id: "env-b", in_use_count: 0 }
        ]);
      }
      if (sql.includes("queue_state = 'admitted'")) {
        expect(sql).toContain("AND EXISTS (");
        expect(sql).toContain("tr.ended_at IS NULL");
        expect(sql).toContain("t.status = 'queued'");
        return buildRowsResult([{
          run_id: "run-b",
          task_id: "task-b",
          workspace_id: "workspace-b",
          environment_id: "env-b",
          dispatch_class: "interactive_new",
          queue_state: "admitted",
          payload_json: claimedPayload,
          eligible_at: "2026-03-21T00:00:00.000Z",
          priority_actor_user_id: null,
          priority_actor_is_super_admin: false,
          queued_at: "2026-03-21T00:01:00.000Z",
          admitted_at: "2026-03-21T00:20:00.000Z",
          started_at: null,
          finished_at: null
        }]);
      }

      throw new Error(`Unhandled query in test: ${sql}`);
    });

    const admittedCount = await runTaskRunDispatchOnce();

    expect(admittedCount).toBe(1);
    expect(mockedQueueAdd).toHaveBeenCalledWith(
      expect.stringContaining("task-task-b-run-run-b"),
      claimedPayload,
      expect.objectContaining({ priority: 3 })
    );
  });

  it("skips expensive scheduler work when there are no eligible pending dispatches", async () => {
    mockedQuery.mockResolvedValueOnce(buildRowsResult([{ exists: false }]));

    const admittedCount = await runTaskRunDispatchOnce();

    expect(admittedCount).toBe(0);
    expect(mockedQuery).toHaveBeenCalledTimes(1);
    expect(String(mockedQuery.mock.calls[0][0])).toContain("SELECT EXISTS");
    expect(mockedQueueAdd).not.toHaveBeenCalled();
  });
});
