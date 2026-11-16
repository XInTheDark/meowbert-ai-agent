import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScratchStorageStatus } from "@meowbert/shared";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  policy: { highWatermark: 0.85, targetWatermark: 0.7, minIdleMinutes: 60, maxIdleDays: 0 }
}));
vi.mock("../../lib/config.js", () => ({ config: { runtime: { taskScratch: { root: "/scratch", eviction: state.policy }, sandbox: { sessionIdleTimeoutMs: 2_700_000 } } } }));
vi.mock("../../lib/db.js", () => ({ withConnection: (fn: (client: unknown) => Promise<unknown>) => fn({ query: state.query }) }));
vi.mock("node:fs/promises", () => ({ default: { mkdir: vi.fn(), rm: vi.fn() } }));
vi.mock("@meowbert/shared", async (original) => ({
  ...await original<typeof import("@meowbert/shared")>(),
  readScratchStorage: vi.fn(), readScratchProjectSizes: vi.fn()
}));
vi.mock("./scratch-eviction-store.js", () => ({ detachIdleScratch: vi.fn(), drainScratchTrash: vi.fn(), listIdleScratchTasks: vi.fn() }));
vi.mock("../runtime/sandbox.js", () => ({ workerSandboxManager: { listManagedContainers: vi.fn() } }));

import fs from "node:fs/promises";
import { readScratchStorage, readScratchProjectSizes } from "@meowbert/shared";
import { workerSandboxManager } from "../runtime/sandbox.js";
import { detachIdleScratch, drainScratchTrash, listIdleScratchTasks } from "./scratch-eviction-store.js";
import { cleanupScratchOnce } from "./scratch-eviction.js";

function status(used: number): ScratchStorageStatus {
  return { capacityBytes: 100, usedBytes: used, availableBytes: 100 - used, limitMb: null, effectiveLimitBytes: 100 };
}
function row(id: string, project: number, days: number) {
  return { id, workspace_id: "workspace", scratch_project_id: project, idle_since: new Date(Date.now() - days * 86_400_000).toISOString() };
}

describe("managed scratch cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    state.policy.maxIdleDays = 0;
    state.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ acquired: true }] };
      if (sql.includes("FROM platform_settings")) return { rows: [{ scratch_storage_limit_mb: null }] };
      return { rows: [] };
    });
    vi.mocked(readScratchStorage).mockResolvedValue(status(90));
    vi.mocked(readScratchProjectSizes).mockResolvedValue(new Map([[1, 200], [2, 2400], [3, 100]]));
    vi.mocked(listIdleScratchTasks).mockResolvedValue([row("small", 1, 7), row("large", 2, 1), row("third", 3, 1)]);
    vi.mocked(workerSandboxManager.listManagedContainers).mockResolvedValue([]);
    vi.mocked(detachIdleScratch).mockImplementation(async (task) => `/scratch/.trash/${task.id}`);
  });

  it("evicts by size and age, remeasures actual usage, and stops at the lower watermark", async () => {
    vi.mocked(readScratchStorage).mockResolvedValueOnce(status(90)).mockResolvedValueOnce(status(90))
      .mockResolvedValueOnce(status(80)).mockResolvedValue(status(65));
    expect(await cleanupScratchOnce()).toBe(2);
    expect(vi.mocked(detachIdleScratch).mock.calls.map(([task]) => task.id)).toEqual(["large", "small"]);
    expect(fs.rm).toHaveBeenCalledWith("/scratch/.trash/large", { recursive: true, force: true });
    expect(drainScratchTrash).toHaveBeenCalledWith("/scratch");
  });

  it("preserves all scratch under budget when age expiry is disabled", async () => {
    vi.mocked(readScratchStorage).mockResolvedValue(status(20));
    expect(await cleanupScratchOnce()).toBe(0);
    expect(detachIdleScratch).not.toHaveBeenCalled();
  });

  it("expires old scratch without pressure while retaining newer folders", async () => {
    state.policy.maxIdleDays = 14;
    vi.mocked(readScratchStorage).mockResolvedValue(status(20));
    vi.mocked(listIdleScratchTasks).mockResolvedValue([row("old", 1, 15), row("new", 2, 1)]);
    expect(await cleanupScratchOnce()).toBe(1);
    expect(detachIdleScratch).toHaveBeenCalledWith(expect.objectContaining({ id: "old" }), expect.any(String));
  });

  it("protects mounted scratch even when task state appeared idle", async () => {
    vi.mocked(workerSandboxManager.listManagedContainers).mockResolvedValue([{ taskId: "large", state: "running" }] as never);
    await cleanupScratchOnce();
    expect(vi.mocked(detachIdleScratch).mock.calls.map(([task]) => task.id)).not.toContain("large");
  });

  it("skips a candidate that becomes active before detach and continues reclaiming others", async () => {
    vi.mocked(detachIdleScratch).mockResolvedValueOnce(null).mockResolvedValueOnce("/scratch/.trash/small").mockResolvedValueOnce(null);
    expect(await cleanupScratchOnce()).toBe(1);
    expect(vi.mocked(detachIdleScratch).mock.calls[0][0].id).toBe("large");
  });

  it("uses age when accounting is unavailable, and stops safely when sandbox inspection fails", async () => {
    vi.mocked(readScratchProjectSizes).mockResolvedValue(null);
    await cleanupScratchOnce();
    expect(vi.mocked(detachIdleScratch).mock.calls[0][0].id).toBe("small");
    vi.mocked(detachIdleScratch).mockClear();
    vi.mocked(workerSandboxManager.listManagedContainers).mockRejectedValue(new Error("Docker unavailable"));
    await expect(cleanupScratchOnce()).rejects.toThrow("Docker unavailable");
    expect(detachIdleScratch).not.toHaveBeenCalled();
    expect(state.query).toHaveBeenLastCalledWith("SELECT pg_advisory_unlock($1)", expect.any(Array));
  });

  it("runs only one cleaner at a time and bounds each pass", async () => {
    state.query.mockResolvedValueOnce({ rows: [{ acquired: false }] });
    expect(await cleanupScratchOnce()).toBe(0);
    expect(drainScratchTrash).not.toHaveBeenCalled();
    vi.mocked(listIdleScratchTasks).mockResolvedValue(Array.from({ length: 25 }, (_, index) => row(`task-${index}`, 1, 1)));
    expect(await cleanupScratchOnce()).toBe(20);
    expect(detachIdleScratch).toHaveBeenCalledTimes(20);
  });
});
