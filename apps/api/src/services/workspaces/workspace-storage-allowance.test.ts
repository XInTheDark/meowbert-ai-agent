import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../users/resource-limits.js", () => ({ resolveWorkspaceStorageLimitBytes: vi.fn() }));
vi.mock("./workspace-storage-usage.js", () => ({ getWorkspaceStorageUsage: vi.fn() }));

import { resolveWorkspaceStorageLimitBytes } from "../users/resource-limits.js";
import {
  assertWorkspaceStorageAvailable,
  recordWorkspaceBytesAdded,
  resolveAvailableWorkspaceBytes,
  WorkspaceStorageLimitError
} from "./workspace-storage-allowance.js";
import { rememberWorkspaceUsedBytes } from "./workspace-storage-usage-cache.js";
import { getWorkspaceStorageUsage } from "./workspace-storage-usage.js";

const mockedLimit = vi.mocked(resolveWorkspaceStorageLimitBytes);
const mockedUsage = vi.mocked(getWorkspaceStorageUsage);

function target(workspaceId: string) {
  return { workspaceId, workspaceRootPath: "/workspace", actorUserId: "user-1" };
}

beforeEach(() => {
  mockedLimit.mockReset();
  mockedUsage.mockReset();
});

describe("workspace storage allowance", () => {
  it("has no allowance to enforce when the workspace is unlimited", async () => {
    mockedLimit.mockResolvedValue(null);

    await expect(resolveAvailableWorkspaceBytes(target("ws-unlimited"))).resolves.toBeNull();
    expect(() => assertWorkspaceStorageAvailable(null, Number.MAX_SAFE_INTEGER)).not.toThrow();
    expect(mockedUsage).not.toHaveBeenCalled();
  });

  it("scans once, then answers from remembered usage plus files added since", async () => {
    mockedLimit.mockResolvedValue(1000);
    mockedUsage.mockImplementation(async (input) => {
      rememberWorkspaceUsedBytes(input.workspaceId, 400);
      return { usedBytes: 400, limitBytes: 1000, availableBytes: 600, usagePercent: 40, isOverLimit: false };
    });

    await expect(resolveAvailableWorkspaceBytes(target("ws-cached"))).resolves.toBe(600);
    recordWorkspaceBytesAdded("ws-cached", 250);
    await expect(resolveAvailableWorkspaceBytes(target("ws-cached"))).resolves.toBe(350);
    expect(mockedUsage).toHaveBeenCalledTimes(1);
  });

  it("rejects new files once the limit is reached or would be exceeded", () => {
    expect(() => assertWorkspaceStorageAvailable(0, 0)).toThrow("Workspace storage is full");
    expect(() => assertWorkspaceStorageAvailable(100, 101)).toThrow(WorkspaceStorageLimitError);
    expect(() => assertWorkspaceStorageAvailable(100, 100)).not.toThrow();
  });
});
