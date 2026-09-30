import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminHostStorageOverview } from "./shared";
import { HostStorageSettingsTab } from "./HostStorageSettingsTab";

function buildOverview(debugMode = false): AdminHostStorageOverview {
  return {
    postgres: {
      databaseName: "meowbert",
      databaseBytes: 25 * 1024 * 1024 * 1024,
      relations: [{
        name: "task_events",
        tableBytes: 23 * 1024 * 1024 * 1024,
        indexBytes: 1024,
        totalBytes: 23 * 1024 * 1024 * 1024 + 1024,
        estimatedLiveRows: 42000,
        estimatedDeadRows: 9000,
        lastVacuumAt: null,
        lastAutovacuumAt: "2026-08-23T00:00:00.000Z"
      }]
    },
    eventRetention: {
      debugMode,
      pruningEnabled: !debugMode,
      retainedEventsPerTask: 20,
      insertPruneBatchSize: 100,
      backlogIntervalSeconds: 60,
      backlogDeleteBatchSize: 5000,
      safetyIntervalHours: 24
    },
    taskHistoryArchive: {
      enabled: true,
      mountPath: "/archive",
      rootPath: "/archive/tasks",
      mounted: true,
      healthState: "ready",
      healthMessage: null,
      warmRetentionDays: 14,
      warmTaskCount: 8,
      archivingTaskCount: 0,
      archivedTaskCount: 12,
      failedTaskCount: 1,
      eligibleTaskCount: 3,
      recentRuns: [{
        id: "run-1",
        taskId: "task-1",
        taskTitle: "Archived task",
        triggerSource: "scheduled",
        status: "completed",
        archiveKey: "v1/task-1.json.gz",
        originalSizeBytes: 1024,
        compressedSizeBytes: 512,
        messageCount: 4,
        eventCount: 20,
        revisionCount: 1,
        workflowMessageCount: 2,
        errorSummary: null,
        createdAt: "2026-08-23T00:00:00.000Z",
        startedAt: "2026-08-23T00:00:01.000Z",
        completedAt: "2026-08-23T00:00:02.000Z"
      }]
    }
  };
}

function renderTab(overview: AdminHostStorageOverview) {
  return renderToStaticMarkup(
    <HostStorageSettingsTab
      overview={overview}
      warmRetentionDaysDraft="14"
      isLoading={false}
      isSavingRetention={false}
      isPruningEvents={false}
      isVacuumingEvents={false}
      isQueueingArchive={false}
      error={null}
      onWarmRetentionDaysDraftChange={vi.fn()}
      onRefresh={vi.fn()}
      onSaveWarmRetentionDays={vi.fn()}
      onPruneEventsNow={vi.fn()}
      onVacuumFullTaskEvents={vi.fn()}
      onArchiveNextEligibleTask={vi.fn()}
    />
  );
}

describe("HostStorageSettingsTab", () => {
  it("shows PostgreSQL usage, archive controls, and recent compressed sizes", () => {
    const html = renderTab(buildOverview());

    expect(html).toContain("25.0 GB");
    expect(html).toContain("23.0 GB");
    expect(html).toContain("Prune one batch now");
    expect(html).toContain("Each insert prunes");
    expect(html).toContain("safety check every 24 hours");
    expect(html).toContain("Run VACUUM FULL");
    expect(html).toContain("exclusive lock");
    expect(html).toContain("Archive next eligible task");
    expect(html).toContain("Archived task");
    expect(html).toContain("Completed");
    expect(html).toContain("1.0 KB");
    expect(html).toContain("512 B");
    expect(html).not.toMatch(/disabled=""[^>]*>Prune one batch now/);
  });

  it("disables manual event cleanup while debug mode is enabled", () => {
    const html = renderTab(buildOverview(true));

    expect(html).toContain("Paused by debug mode");
    expect(html).toMatch(/disabled=""[^>]*>Prune one batch now/);
  });

  it("keeps archive retry available while a previous run is active or no task is currently eligible", () => {
    const overview = buildOverview();
    overview.taskHistoryArchive.eligibleTaskCount = 0;
    overview.taskHistoryArchive.recentRuns = [{
      ...overview.taskHistoryArchive.recentRuns[0],
      status: "running"
    }];

    const html = renderTab(overview);

    expect(html).toMatch(/Archive next eligible task/);
    expect(html).not.toMatch(/disabled=""[^>]*>Archive next eligible task/);
  });
});
