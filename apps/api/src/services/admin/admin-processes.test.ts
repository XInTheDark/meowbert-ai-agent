import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

import { query } from "../../lib/db.js";
import { listAdminProcesses } from "./admin-processes.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("admin processes service", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists active task processes with joined task, run, and owner metadata", async () => {
    mockedQuery.mockImplementation(async (sql: string, params?: unknown[]) => {
      expect(sql).toContain("LEFT JOIN LATERAL");
      expect(sql).toContain("LEFT JOIN task_run_dispatches");
      expect(params).toEqual([["queued", "starting", "running"]]);

      return buildRowsResult([
        {
          task_id: "task-running",
          task_title: "Investigate sandbox leak",
          task_status: "running",
          task_source: "web",
          workflow_type: null,
          created_at: "2026-04-17T12:00:00.000Z",
          updated_at: "2026-04-17T12:04:00.000Z",
          workspace_id: "ws-1",
          workspace_name: "Alpha",
          project_id: "proj-1",
          project_name: "Primary Project",
          initiator_user_id: "user-1",
          initiator_email: "owner@example.com",
          initiator_display_name: "Owner",
          run_id: "run-1",
          run_attempt_no: 2,
          run_kind: "default",
          run_started_at: "2026-04-17T12:01:00.000Z",
          worker_id: "4242",
          dispatch_queue_state: "running",
          dispatch_class: "interactive",
          dispatch_queued_at: "2026-04-17T12:00:30.000Z",
          dispatch_started_at: "2026-04-17T12:01:00.000Z"
        },
        {
          task_id: "task-queued",
          task_title: null,
          task_status: "queued",
          task_source: "email",
          workflow_type: "long_horizon",
          created_at: "2026-04-17T12:02:00.000Z",
          updated_at: "2026-04-17T12:05:00.000Z",
          workspace_id: "ws-2",
          workspace_name: "Beta",
          project_id: "proj-2",
          project_name: "Ops",
          initiator_user_id: null,
          initiator_email: null,
          initiator_display_name: null,
          run_id: "run-2",
          run_attempt_no: 1,
          run_kind: "default",
          run_started_at: null,
          worker_id: null,
          dispatch_queue_state: "pending",
          dispatch_class: "background",
          dispatch_queued_at: "2026-04-17T12:02:15.000Z",
          dispatch_started_at: null
        }
      ]);
    });

    const processes = await listAdminProcesses();

    expect(processes).toEqual({
      totalCount: 2,
      queuedCount: 1,
      startingCount: 0,
      runningCount: 1,
      processes: [
        {
          taskId: "task-running",
          taskTitle: "Investigate sandbox leak",
          taskStatus: "running",
          taskSource: "web",
          workflowType: null,
          createdAt: "2026-04-17T12:00:00.000Z",
          updatedAt: "2026-04-17T12:04:00.000Z",
          workspaceId: "ws-1",
          workspaceName: "Alpha",
          projectId: "proj-1",
          projectName: "Primary Project",
          initiatorUserId: "user-1",
          initiatorEmail: "owner@example.com",
          initiatorDisplayName: "Owner",
          runId: "run-1",
          runAttemptNo: 2,
          runKind: "default",
          runStartedAt: "2026-04-17T12:01:00.000Z",
          workerId: "4242",
          dispatchQueueState: "running",
          dispatchClass: "interactive",
          dispatchQueuedAt: "2026-04-17T12:00:30.000Z",
          dispatchStartedAt: "2026-04-17T12:01:00.000Z"
        },
        {
          taskId: "task-queued",
          taskTitle: null,
          taskStatus: "queued",
          taskSource: "email",
          workflowType: "long_horizon",
          createdAt: "2026-04-17T12:02:00.000Z",
          updatedAt: "2026-04-17T12:05:00.000Z",
          workspaceId: "ws-2",
          workspaceName: "Beta",
          projectId: "proj-2",
          projectName: "Ops",
          initiatorUserId: null,
          initiatorEmail: null,
          initiatorDisplayName: null,
          runId: "run-2",
          runAttemptNo: 1,
          runKind: "default",
          runStartedAt: null,
          workerId: null,
          dispatchQueueState: "pending",
          dispatchClass: "background",
          dispatchQueuedAt: "2026-04-17T12:02:15.000Z",
          dispatchStartedAt: null
        }
      ]
    });
  });
});
