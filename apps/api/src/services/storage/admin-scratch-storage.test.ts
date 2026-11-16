import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("node:fs/promises", () => ({ default: { mkdir: vi.fn() } }));
vi.mock("@meowbert/shared", () => ({ readScratchStorage: vi.fn() }));
vi.mock("../../lib/config.js", () => ({ config: { runtime: { taskScratch: { root: "/scratch", eviction: { highWatermark: 0.85 } } } } }));
vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
import { query } from "../../lib/db.js";
import { readScratchStorage } from "@meowbert/shared";
import { getAdminScratchStorage, updateAdminScratchStorage } from "./admin-scratch-storage.js";

describe("Admin scratch budget", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(query).mockResolvedValue({ rows: [{ scratch_storage_limit_mb: "20" }] } as never);
    vi.mocked(readScratchStorage).mockResolvedValue({ capacityBytes: 40 * 1024 * 1024, usedBytes: 10, availableBytes: 30, limitMb: 20, effectiveLimitBytes: 20 * 1024 * 1024 });
  });
  it("loads the budget separately from workspace storage limits", async () => {
    expect(await getAdminScratchStorage()).toMatchObject({ limitMb: 20, highWatermark: 0.85 });
    expect(readScratchStorage).toHaveBeenCalledWith("/scratch", 20);
  });
  it.each([0, -1, 41, 1.5, Number.NaN])("rejects invalid or over-capacity budget %s before persistence", async (value) => {
    await expect(updateAdminScratchStorage(value)).rejects.toMatchObject({ statusCode: 400 });
    expect(query).toHaveBeenCalledTimes(1);
  });
  it.each([null, 15, 40])("saves a valid budget or automatic capacity %s", async (value) => {
    await updateAdminScratchStorage(value);
    expect(query).toHaveBeenCalledWith("UPDATE platform_settings SET scratch_storage_limit_mb = $1 WHERE id = 1", [value]);
  });
});
