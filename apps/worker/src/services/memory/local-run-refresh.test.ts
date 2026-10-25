import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../workspaces/workspace-storage.js", () => ({ resolveTaskWorkspaceRoot: vi.fn().mockResolvedValue("/workspace") }));
vi.mock("./watcher.js", () => ({ syncWorkspaceMemoryNow: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./storage.js", () => ({ readMemorySyncStatus: vi.fn() }));
import { query } from "../../lib/db.js";
import { syncWorkspaceMemoryNow } from "./watcher.js";
import { readMemorySyncStatus } from "./storage.js";
import { refreshLocalRunMemoryOnce } from "./local-run-refresh.js";

beforeEach(() => { vi.clearAllMocks(); });
it("retains failed syncs for retry even when the watcher reports errors through status", async () => {
  const refresh = { run_id: "run", workspace_id: "workspace", delay_seconds: 60, root_path: "/workspace" };
  vi.mocked(query).mockResolvedValue({ rows: [refresh] } as never);
  vi.mocked(readMemorySyncStatus).mockResolvedValue({ state: "error", error: "mount unavailable" } as never);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  await refreshLocalRunMemoryOnce();
  expect(query).toHaveBeenCalledTimes(1);
  vi.mocked(readMemorySyncStatus).mockResolvedValue({ state: "ready" } as never);
  await refreshLocalRunMemoryOnce();
  expect(syncWorkspaceMemoryNow).toHaveBeenCalledTimes(2);
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining("DELETE"), ["run", 60]);
  warning.mockRestore();
});

it("removes refresh requests for device folders without trying to index server paths", async () => {
  vi.mocked(query).mockResolvedValue({ rows: [{ run_id: "run", workspace_id: "workspace", delay_seconds: 60, file_host: { kind: "device", deviceId: "11111111-1111-4111-8111-111111111111" } }] } as never);
  await refreshLocalRunMemoryOnce();
  expect(syncWorkspaceMemoryNow).not.toHaveBeenCalled();
  expect(query).toHaveBeenLastCalledWith(expect.stringContaining("DELETE"), ["run", 60]);
});
