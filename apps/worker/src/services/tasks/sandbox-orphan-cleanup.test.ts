import type { QueryResult } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../runtime/sandbox.js", () => ({
  workerSandboxManager: {
    getCurrentContainerId: vi.fn(() => null),
    listManagedContainers: vi.fn(async () => []),
    listRunningContainerIds: vi.fn(async () => []),
    stopAndRemoveContainer: vi.fn(async () => undefined)
  }
}));

import type { ManagedSandboxContainerSummary } from "@meowbert/shared/docker-sandbox";
import { query } from "../../lib/db.js";
import { cleanupSandboxOrphansOnce } from "./sandbox-orphan-cleanup.js";

function sandbox(
  containerId: string,
  overrides: Partial<ManagedSandboxContainerSummary> = {}
): ManagedSandboxContainerSummary {
  return {
    containerId,
    image: "sandbox-image",
    state: "running",
    status: "Up 1 minute",
    createdAt: new Date().toISOString(),
    purpose: "task-run",
    workspaceId: "ws-1",
    environmentId: "env-1",
    taskId: null,
    runId: null,
    sessionId: null,
    parentContainerId: null,
    ...overrides
  };
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

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
      listRunningContainerIds: vi.fn(async () => ["api-parent", "worker-parent"]),
      stopAndRemoveContainer: vi.fn(async () => undefined)
    };

    const removedCount = await cleanupSandboxOrphansOnce(manager);

    expect(removedCount).toBe(3);
    expect(manager.stopAndRemoveContainer).toHaveBeenCalledTimes(3);
    expect(manager.stopAndRemoveContainer).toHaveBeenCalledWith("remove-stale-task");
    expect(manager.stopAndRemoveContainer).toHaveBeenCalledWith("remove-exited-same-parent");
    expect(manager.stopAndRemoveContainer).toHaveBeenCalledWith("remove-stale-persistent-session");
  });

  function mockActiveRows(): void {
    mockedQuery
      .mockResolvedValueOnce(buildRowsResult([{ task_id: "task-live", run_id: "run-live" }]))
      .mockResolvedValueOnce(buildRowsResult([{ id: "session-live" }]));
  }

  function managerWith(
    containers: ManagedSandboxContainerSummary[],
    runningContainerIds: string[],
    currentContainerId = "worker-1"
  ) {
    return {
      getCurrentContainerId: vi.fn(() => currentContainerId),
      listManagedContainers: vi.fn(async () => containers),
      listRunningContainerIds: vi.fn(async () => runningContainerIds),
      stopAndRemoveContainer: vi.fn(async () => undefined)
    };
  }

  function removedIds(manager: ReturnType<typeof managerWith>): string[] {
    return manager.stopAndRemoveContainer.mock.calls.map(([id]) => id).sort();
  }

  it("removes sandboxes whose parent process is gone, but keeps live persistent sessions", async () => {
    mockActiveRows();
    const manager = managerWith([
      sandbox("live-run-dead-parent", { taskId: "task-live", runId: "run-live", parentContainerId: "dead-worker" }),
      sandbox("shell-exec-dead-parent", { purpose: "shell-exec", parentContainerId: "dead-worker" }),
      sandbox("api-shell-dead-parent", { purpose: "shell-session", parentContainerId: "dead-api" }),
      sandbox("session-dead-parent", { purpose: "shell-session", sessionId: "session-live", parentContainerId: "dead-worker" }),
      sandbox("live-run-live-parent", { taskId: "task-live", runId: "run-live", parentContainerId: "worker-1" })
    ], ["worker-1-full-container-id"]);

    await cleanupSandboxOrphansOnce(manager);

    expect(removedIds(manager)).toEqual(["api-shell-dead-parent", "live-run-dead-parent", "shell-exec-dead-parent"]);
  });

  it("judges no parent gone when this worker cannot find its own container", async () => {
    mockActiveRows();
    const manager = managerWith([
      sandbox("live-run", { taskId: "task-live", runId: "run-live", parentContainerId: "other-worker" })
    ], ["unrelated-container"]);

    await cleanupSandboxOrphansOnce(manager);

    expect(manager.stopAndRemoveContainer).not.toHaveBeenCalled();
  });

  it("removes running shell-exec sandboxes that outlived their tool listing", async () => {
    mockActiveRows();
    const manager = managerWith([
      sandbox("old-shell-exec", { purpose: "shell-exec", createdAt: new Date(Date.now() - 6 * 60_000).toISOString() }),
      sandbox("fresh-shell-exec", { purpose: "shell-exec" })
    ], ["worker-1"]);

    await cleanupSandboxOrphansOnce(manager);

    expect(removedIds(manager)).toEqual(["old-shell-exec"]);
  });

  it("keeps a warm sandbox after its run ends, until its worker is gone", async () => {
    mockActiveRows();
    const manager = managerWith([
      sandbox("warm-live-parent", { taskId: "task-done", runId: "run-done", parentContainerId: "worker-1" }),
      sandbox("warm-dead-parent", { taskId: "task-done-2", runId: "run-done-2", parentContainerId: "dead-worker" }),
      sandbox("not-warm", { taskId: "task-done-3", runId: "run-done-3", parentContainerId: "worker-1", createdAt: minutesAgo(3) })
    ], ["worker-1"]);

    await cleanupSandboxOrphansOnce(manager, async () => new Set(["warm-live-parent", "warm-dead-parent"]));

    expect(removedIds(manager)).toEqual(["not-warm", "warm-dead-parent"]);
  });

  it("keeps a new sandbox whose run is not in the active list yet, then removes it once it is old", async () => {
    mockActiveRows();
    const manager = managerWith([
      sandbox("still-starting", { state: "created", taskId: "task-new", runId: "run-new", parentContainerId: "worker-1" }),
      sandbox("just-started", { taskId: "task-new-2", runId: "run-new-2", parentContainerId: "worker-1" }),
      sandbox("old-stale", { taskId: "task-old", runId: "run-old", parentContainerId: "worker-1", createdAt: minutesAgo(3) }),
      sandbox("young-exited", { state: "exited", taskId: "task-x", runId: "run-x", parentContainerId: "worker-1" }),
      sandbox("young-dead-parent", { taskId: "task-y", runId: "run-y", parentContainerId: "dead-worker" })
    ], ["worker-1"]);

    await cleanupSandboxOrphansOnce(manager);

    expect(removedIds(manager)).toEqual(["old-stale", "young-dead-parent", "young-exited"]);
  });

  it("reads active runs after listing containers, so a run that starts during a slow listing is kept", async () => {
    const order: string[] = [];
    mockedQuery.mockImplementation(async (sql: string) => {
      order.push("db");
      return sql.includes("persistent_shell_sessions")
        ? buildRowsResult([])
        : buildRowsResult([{ task_id: "task-new", run_id: "run-new" }]);
    });
    const manager = managerWith([], ["worker-1"]);
    manager.listManagedContainers.mockImplementation(async () => {
      order.push("docker");
      return [sandbox("new-run", { taskId: "task-new", runId: "run-new", parentContainerId: "worker-1", createdAt: minutesAgo(3) })];
    });

    await cleanupSandboxOrphansOnce(manager, async () => new Set());

    expect(order[0]).toBe("docker");
    expect(order.slice(1)).toEqual(["db", "db"]);
    expect(manager.stopAndRemoveContainer).not.toHaveBeenCalled();
  });
});
