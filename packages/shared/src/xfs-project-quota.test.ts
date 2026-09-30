import { describe, expect, it, vi } from "vitest";
import { XfsProjectQuotaManager, resolveWorkspaceStorageUnitRoot } from "./xfs-project-quota.js";

describe("resolveWorkspaceStorageUnitRoot", () => {
  it("returns the parent directory of the workspace root", () => {
    expect(resolveWorkspaceStorageUnitRoot("/runtime/workspaces/ws-1/root")).toBe("/runtime/workspaces/ws-1");
  });
});

describe("XfsProjectQuotaManager", () => {
  it("checks project quota state for a mount path", async () => {
    const execFile = vi.fn(async () => ({
      stdout: "Project quota state on /runtime/workspaces (/dev/sdb1)\nAccounting: ON\nEnforcement: ON\n",
      stderr: ""
    }));
    const manager = new XfsProjectQuotaManager({
      commandRunner: { execFile }
    });

    const status = await manager.inspectMount({
      mountPath: "/runtime/workspaces"
    });

    expect(execFile).toHaveBeenCalledWith("xfs_quota", ["-x", "-c", "state -p", "/runtime/workspaces"]);
    expect(status.ready).toBe(true);
    expect(status.message).toContain("Project quota state");
  });

  it("provisions a project id and strict block quota for a workspace unit", async () => {
    const execFile = vi.fn(async () => ({
      stdout: "",
      stderr: ""
    }));
    const manager = new XfsProjectQuotaManager({
      commandRunner: { execFile }
    });

    await manager.applyProjectQuota({
      mountPath: "/runtime/workspaces",
      storageUnitRoot: "/runtime/workspaces/ws with space",
      projectId: 10023,
      quotaBytes: 10 * 1024 * 1024
    });

    expect(execFile).toHaveBeenCalledWith("xfs_quota", [
      "-x",
      "-c",
      "project -s -p '/runtime/workspaces/ws with space' 10023",
      "-c",
      "limit -p bsoft=10m bhard=10m 10023",
      "/runtime/workspaces"
    ]);
  });
});
