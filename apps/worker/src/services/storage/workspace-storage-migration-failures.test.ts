import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({ query: vi.fn(), withTransaction: vi.fn() }));
vi.mock("./migration-filesystem.js", () => ({ resetManagedStorageRoot: vi.fn(), copyDirectoryContents: vi.fn() }));
vi.mock("@meowbert/shared/storage-backend-runtime", () => ({ isStoragePathEmpty: vi.fn(async () => true) }));
vi.mock("../runtime/environment-storage.js", () => ({
  resolveTaskEnvironmentRoot: vi.fn(), resolveManagedTaskEnvironmentRoot: vi.fn()
}));
vi.mock("../workspaces/workspace-storage.js", () => ({
  resolveTaskWorkspaceRoot: vi.fn(async () => "/source"),
  resolveManagedTaskWorkspaceRoot: vi.fn(async () => "/target")
}));

import { query, withTransaction } from "../../lib/db.js";
import { copyDirectoryContents, resetManagedStorageRoot } from "./migration-filesystem.js";
import { recoverStaleWorkspaceStorageMigrationsOnce, runWorkspaceStorageMigrationLoopOnce } from "./workspace-storage-migrations.js";

const migration = {
  id: "migration-1", workspace_id: "workspace-1", source_backend_id: "local", target_backend_id: "cloud"
};
const rows = (items: object[] = []) => ({ rows: items, rowCount: items.length } as never);
let currentBackend: string;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  currentBackend = "local";
  let claimed = false;
  vi.mocked(withTransaction).mockImplementation(async (callback) => {
    const client = { query: vi.fn().mockResolvedValue(rows()) };
    if (!claimed) {
      claimed = true;
      client.query.mockResolvedValueOnce(rows([{ id: migration.id }])).mockResolvedValueOnce(rows([migration]));
    }
    return callback(client as never);
  });
  vi.mocked(query).mockImplementation(async (sql) => {
    if (sql.includes("FROM workspaces")) {
      return rows([{ id: migration.workspace_id, root_path: "/source", storage_backend_id: currentBackend }]);
    }
    return rows();
  });
  vi.mocked(resetManagedStorageRoot).mockResolvedValue(undefined);
  vi.mocked(copyDirectoryContents).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("migration recovery under slow or failed filesystem operations", () => {
  it("keeps the recovery lease alive beyond the stale threshold and stops heartbeating afterward", async () => {
    vi.useFakeTimers();
    let finishReset!: () => void;
    vi.mocked(resetManagedStorageRoot).mockImplementationOnce(() => new Promise((resolve) => { finishReset = resolve; }));
    const recovery = recoverStaleWorkspaceStorageMigrationsOnce("worker-1");
    await vi.advanceTimersByTimeAsync(35_000);

    const heartbeats = () => vi.mocked(query).mock.calls.filter(([sql]) => sql.includes("SET heartbeat_at = now()"));
    expect(resetManagedStorageRoot).toHaveBeenCalledWith("/target");
    expect(heartbeats()).toHaveLength(8);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("SET status = 'queued'"), expect.anything());
    finishReset();
    await expect(recovery).resolves.toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(heartbeats()).toHaveLength(8);
  });

  it("marks a failed or timed-out recovery failed without requeuing it or switching the source", async () => {
    vi.mocked(resetManagedStorageRoot).mockRejectedValueOnce(new Error("filesystem operation limit"));
    await expect(recoverStaleWorkspaceStorageMigrationsOnce("worker-1")).resolves.toBe(0);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = $2"), [
      migration.id, "failed", expect.stringContaining("filesystem operation limit")
    ]);
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining("SET status = 'queued'"), expect.anything());
    expect(copyDirectoryContents).not.toHaveBeenCalled();
  });

  it("refuses to clear the target if it has become the authoritative backend", async () => {
    currentBackend = "cloud";
    await expect(recoverStaleWorkspaceStorageMigrationsOnce("worker-1")).resolves.toBe(0);
    expect(resetManagedStorageRoot).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = $2"), [
      migration.id, "failed", expect.stringContaining("refusing to clear the target")
    ]);
  });

  it("does not switch workspace storage after a copy failure", async () => {
    vi.mocked(copyDirectoryContents).mockRejectedValueOnce(new Error("source read failed"));
    await expect(runWorkspaceStorageMigrationLoopOnce("worker-1")).resolves.toBe(true);
    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = $2"), [
      migration.id, "failed", "source read failed"
    ]);
  });
});
