import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { QueryResult } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

import { query } from "../../lib/db.js";
import { buildEnvironmentCleanupPlan } from "./environment-file-cleanup.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

function writeTaskRun(root: string, taskId: string, sizeBytes: number): void {
  const absolutePath = path.join(root, ".meowbert", "task-runs", taskId, "payload.bin");
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, Buffer.alloc(sizeBytes, "x"));
}

describe("environment file cleanup", () => {
  const mockedQuery = vi.mocked(query);
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-12T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop();
      if (tempDir) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it("returns every matching candidate while only preselecting enough bytes to hit the target", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-cleanup-plan-"));
    tempDirs.push(root);

    const taskIds = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333"
    ];
    writeTaskRun(root, taskIds[0], 100);
    writeTaskRun(root, taskIds[1], 60);
    writeTaskRun(root, taskIds[2], 40);

    mockedQuery.mockResolvedValue(buildRowsResult(taskIds.map((id, index) => ({
      id,
      title: `Task ${index + 1}`,
      status: "succeeded",
      updated_at: "2026-03-01T00:00:00.000Z",
      completed_at: "2026-03-01T00:00:00.000Z"
    }))));

    const plan = await buildEnvironmentCleanupPlan({
      environmentId: "env-1",
      rootPath: root,
      targetPercent: 50
    });

    expect(plan.reclaimableBytes).toBe(200);
    expect(plan.targetBytes).toBe(100);
    expect(plan.suggestedBytes).toBe(100);
    expect(plan.suggestions.map((entry) => entry.relativePath)).toEqual([
      `.meowbert/task-runs/${taskIds[0]}`,
      `.meowbert/task-runs/${taskIds[1]}`,
      `.meowbert/task-runs/${taskIds[2]}`
    ]);
  });

  it("applies date and size filters before building the cleanup plan", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-cleanup-plan-"));
    tempDirs.push(root);

    const taskIds = [
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
      "66666666-6666-4666-8666-666666666666"
    ];
    writeTaskRun(root, taskIds[0], 10);
    writeTaskRun(root, taskIds[1], 20);
    writeTaskRun(root, taskIds[2], 30);

    mockedQuery.mockResolvedValue(buildRowsResult([
      {
        id: taskIds[0],
        title: "Too old",
        status: "succeeded",
        updated_at: "2026-03-01T12:00:00.000Z",
        completed_at: "2026-03-01T12:00:00.000Z"
      },
      {
        id: taskIds[1],
        title: "Keep me",
        status: "failed",
        updated_at: "2026-03-07T12:00:00.000Z",
        completed_at: "2026-03-07T12:00:00.000Z"
      },
      {
        id: taskIds[2],
        title: "Too large",
        status: "cancelled",
        updated_at: "2026-03-10T12:00:00.000Z",
        completed_at: "2026-03-10T12:00:00.000Z"
      }
    ]));

    const plan = await buildEnvironmentCleanupPlan({
      environmentId: "env-1",
      rootPath: root,
      targetPercent: 50,
      filters: {
        modifiedAfter: "2026-03-05",
        modifiedBefore: "2026-03-09",
        minSizeBytes: 15,
        maxSizeBytes: 25
      }
    });

    expect(plan.reclaimableBytes).toBe(20);
    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0]).toMatchObject({
      relativePath: `.meowbert/task-runs/${taskIds[1]}`,
      sizeBytes: 20,
      taskTitle: "Keep me"
    });
  });
});
