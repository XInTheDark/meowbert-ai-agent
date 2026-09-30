import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { query } from "../../lib/db.js";

vi.mock("../../lib/queue.js", () => ({
  taskQueue: {
    add: vi.fn()
  }
}));

vi.mock("../../lib/db.js", () => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

let ensureRecurringTaskStateFile: (typeof import("./service.js"))["ensureRecurringTaskStateFile"];
let resolveContinuationModeForInterruptedTask: (typeof import("./service.js"))["resolveContinuationModeForInterruptedTask"];

const tempRoots: string[] = [];
const mockedQuery = vi.mocked(query);

beforeAll(async () => {
  ({ ensureRecurringTaskStateFile, resolveContinuationModeForInterruptedTask } = await import("./service.js"));
});

afterEach(() => {
  mockedQuery.mockReset();
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-recurring-test-"));
  tempRoots.push(root);
  return root;
}

describe("ensureRecurringTaskStateFile", () => {
  it("creates TASK.md with recurring schedule metadata", () => {
    const envRoot = createTempRoot();
    const taskPath = ensureRecurringTaskStateFile({
      taskRootPath: ".meowbert/task-runs/task-1",
      envRoot,
      objective: "Watch upstream API changes",
      schedule: {
        mode: "scheduled",
        scheduleState: "active",
        repeat: "*/5 * * * *",
        timezone: "UTC",
        nextRunAt: null,
        pendingRun: false,
        runTimeoutSeconds: null,
        runDeadlineAt: null
      }
    });

    expect(fs.existsSync(taskPath)).toBe(true);
    const content = fs.readFileSync(taskPath, "utf-8");
    expect(content).toContain("Mode: scheduled");
    expect(content).toContain("Repeat: */5 * * * *");
    expect(content).toContain("Run time limit: none");
    expect(content).toContain("Watch upstream API changes");
  });

  it("does not overwrite existing TASK.md content", () => {
    const envRoot = createTempRoot();
    const taskPath = ensureRecurringTaskStateFile({
      taskRootPath: ".meowbert/task-runs/task-2",
      envRoot,
      objective: "Initial objective",
      schedule: {
        mode: "infinite",
        scheduleState: "active",
        repeat: null,
        timezone: "UTC",
        nextRunAt: null,
        pendingRun: false,
        runTimeoutSeconds: 1800,
        runDeadlineAt: "2026-03-12T06:30:00.000Z"
      }
    });

    fs.writeFileSync(taskPath, "custom-content\n", "utf-8");

    const secondPath = ensureRecurringTaskStateFile({
      taskRootPath: ".meowbert/task-runs/task-2",
      envRoot,
      objective: "Changed objective",
      schedule: {
        mode: "infinite",
        scheduleState: "paused",
        repeat: null,
        timezone: "UTC",
        nextRunAt: null,
        pendingRun: false,
        runTimeoutSeconds: 1800,
        runDeadlineAt: "2026-03-12T06:30:00.000Z"
      }
    });

    expect(secondPath).toBe(taskPath);
    expect(fs.readFileSync(taskPath, "utf-8")).toBe("custom-content\n");
  });

  it("records timed task deadlines in TASK.md", () => {
    const envRoot = createTempRoot();
    const taskPath = ensureRecurringTaskStateFile({
      taskRootPath: ".meowbert/task-runs/task-3",
      envRoot,
      objective: "Watch market open",
      schedule: {
        mode: "infinite",
        scheduleState: "active",
        repeat: null,
        timezone: "UTC",
        nextRunAt: null,
        pendingRun: false,
        runTimeoutSeconds: 1800,
        runDeadlineAt: "2026-03-12T06:30:00.000Z"
      }
    });

    const content = fs.readFileSync(taskPath, "utf-8");
    expect(content).toContain("Run time limit: 1800s");
    expect(content).toContain("Current deadline: 2026-03-12T06:30:00.000Z");
  });
});

describe("resolveContinuationModeForInterruptedTask", () => {
  it("keeps timed recurring tasks in infinite auto mode after interruption", async () => {
    mockedQuery.mockResolvedValueOnce({
      command: "SELECT",
      fields: [],
      oid: 0,
      rows: [{ mode: "infinite", run_timeout_seconds: 1800 }],
      rowCount: 1
    });

    await expect(resolveContinuationModeForInterruptedTask("task-1", "infinite_auto")).resolves.toBe("infinite_auto");
  });

  it("keeps untimed infinite tasks as manual check-ins after interruption", async () => {
    mockedQuery.mockResolvedValueOnce({
      command: "SELECT",
      fields: [],
      oid: 0,
      rows: [{ mode: "infinite", run_timeout_seconds: null }],
      rowCount: 1
    });

    await expect(resolveContinuationModeForInterruptedTask("task-2", "infinite_auto")).resolves.toBe("infinite_checkin");
  });
});
