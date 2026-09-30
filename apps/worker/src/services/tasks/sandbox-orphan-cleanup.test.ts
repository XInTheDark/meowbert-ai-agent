import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../runtime/sandbox.js", () => ({
  workerSandboxManager: {
    getCurrentContainerId: vi.fn(() => null),
    listManagedContainers: vi.fn(async () => []),
    stopAndRemoveContainer: vi.fn(async () => undefined)
  }
}));

import { query } from "../../lib/db.js";
import { cleanupSandboxOrphansOnce } from "./sandbox-orphan-cleanup.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("sandbox orphan cleanup", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes task-bound containers that do not match a live starting or running run", async () => {
    mockedQuery
      .mockResolvedValueOnce(buildRowsResult([
        { task_id: "task-live", run_id: "run-live" }
      ]))
      .mockResolvedValueOnce(buildRowsResult([
        { id: "session-1" }
      ]));

    const manager = {
      getCurrentContainerId: vi.fn(() => "api-parent"),
      listManagedContainers: vi.fn(async () => [
        {
          containerId: "keep-live",
          image: "sandbox-image",
          state: "running",
          status: "Up 5 minutes",
          createdAt: "2026-04-18T00:00:00.000Z",
          purpose: "task-run" as const,
          workspaceId: "ws-1",
          environmentId: "env-1",
          taskId: "task-live",
          runId: "run-live",
          sessionId: null,
          parentContainerId: "worker-parent"
        },
        {
          containerId: "remove-stale-task",
          image: "sandbox-image",
          state: "running",
          status: "Up 10 minutes",
          createdAt: "2026-04-18T00:00:00.000Z",
          purpose: "task-run" as const,
          workspaceId: "ws-1",
          environmentId: "env-1",
          taskId: "task-stale",
          runId: "run-stale",
          sessionId: null,
          parentContainerId: "worker-parent"
        },
        {
          containerId: "remove-exited-same-parent",
          image: "sandbox-image",
          state: "exited",
          status: "Exited (0) 3 minutes ago",
          createdAt: "2026-04-18T00:00:00.000Z",
          purpose: "shell-exec" as const,
          workspaceId: "ws-1",
          environmentId: "env-1",
          taskId: null,
          runId: null,
          sessionId: null,
          parentContainerId: "api-parent"
        },
        {
          containerId: "keep-api-session",
          image: "sandbox-image",
          state: "running",
          status: "Up 2 minutes",
          createdAt: "2026-04-18T00:00:00.000Z",
          purpose: "shell-session" as const,
          workspaceId: "ws-1",
          environmentId: "env-1",
          taskId: null,
          runId: null,
          sessionId: "session-1",
          parentContainerId: "api-parent"
        },
        {
          containerId: "remove-stale-persistent-session",
          image: "sandbox-image",
          state: "exited",
          status: "Exited (137) 2 minutes ago",
          createdAt: "2026-04-18T00:00:00.000Z",
          purpose: "shell-session" as const,
          workspaceId: "ws-1",
          environmentId: "env-1",
          taskId: null,
          runId: null,
          sessionId: "stale-session",
          parentContainerId: "worker-parent"
        }
      ]),
      stopAndRemoveContainer: vi.fn(async () => undefined)
    };

    const removedCount = await cleanupSandboxOrphansOnce(manager);

    expect(removedCount).toBe(3);
    expect(manager.stopAndRemoveContainer).toHaveBeenCalledTimes(3);
    expect(manager.stopAndRemoveContainer).toHaveBeenCalledWith("remove-stale-task");
    expect(manager.stopAndRemoveContainer).toHaveBeenCalledWith("remove-exited-same-parent");
    expect(manager.stopAndRemoveContainer).toHaveBeenCalledWith("remove-stale-persistent-session");
  });
});
