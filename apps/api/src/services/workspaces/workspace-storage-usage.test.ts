import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../storage/local-xfs-project-quotas.js", () => ({
  hasLocalXfsProjectQuota: vi.fn()
}));

vi.mock("../users/resource-limits.js", () => ({
  resolveWorkspaceStorageLimitBytes: vi.fn()
}));

vi.mock("./workspace-storage.js", () => ({
  ensureWorkspaceStorageRoot: vi.fn(),
  resolveWorkspaceBackendId: vi.fn(async () => "backend-1")
}));

import { hasLocalXfsProjectQuota } from "../storage/local-xfs-project-quotas.js";
import { resolveWorkspaceStorageLimitBytes } from "../users/resource-limits.js";
import { ensureWorkspaceStorageRoot } from "./workspace-storage.js";
import { getWorkspaceStorageUsage } from "./workspace-storage-usage.js";

describe("workspace storage usage service", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkspaceStorageLimitBytes).mockResolvedValue(1024 * 1024);
  });

  afterEach(() => {
    for (const tempDir of tempDirs.splice(0)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("reports no usage for backends without an XFS project quota and leaves the filesystem alone", async () => {
    vi.mocked(hasLocalXfsProjectQuota).mockReturnValue(false);

    await expect(getWorkspaceStorageUsage({ workspaceId: "ws-1", workspaceRootPath: "/mnt/drive/ws-1/workspace" }))
      .resolves.toBeNull();
    expect(ensureWorkspaceStorageRoot).not.toHaveBeenCalled();
  });

  it("reads usage for quota-backed workspaces from statfs on the storage unit", async () => {
    const unitRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-storage-unit-"));
    tempDirs.push(unitRoot);
    const workspaceRoot = path.join(unitRoot, "workspace");
    fs.mkdirSync(workspaceRoot);
    vi.mocked(hasLocalXfsProjectQuota).mockReturnValue(true);
    vi.mocked(ensureWorkspaceStorageRoot).mockResolvedValue(workspaceRoot);
    const statfsSpy = vi.spyOn(fs.promises, "statfs");

    const storage = await getWorkspaceStorageUsage({ workspaceId: "ws-1", workspaceRootPath: workspaceRoot });

    expect(statfsSpy).toHaveBeenCalledWith(unitRoot);
    expect(storage).toMatchObject({ limitBytes: 1024 * 1024 });
    expect(storage?.usedBytes).toBeGreaterThanOrEqual(0);
    statfsSpy.mockRestore();
  });
});
