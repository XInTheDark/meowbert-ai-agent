import { describe, expect, it, vi } from "vitest";

vi.mock("../runtime/sandbox.js", () => ({
  apiSandboxManager: { createPersistentSandbox: vi.fn() }
}));
vi.mock("../users/resource-limits.js", () => ({
  resolveUserSandboxContainerResources: vi.fn()
}));

import { resolveUserSandboxContainerResources } from "../users/resource-limits.js";
import { listActiveCanvasSandboxSessionIds, startCanvasDevServer } from "./canvas-dev-server.js";
import type { ProjectCanvasSummary } from "./project-canvases.js";

describe("canvas sandbox ownership", () => {
  it("protects a starting preview from orphan cleanup and releases ownership after failed startup", async () => {
    let rejectResources!: (error: Error) => void;
    vi.mocked(resolveUserSandboxContainerResources).mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectResources = reject;
    }));
    const started = startCanvasDevServer({
      canvas: { id: "starting", rootPath: "canvas", devServer: {} } as ProjectCanvasSummary,
      ownerUserId: "user", environmentRootPath: "/project", workspaceRootPath: "/workspace"
    });
    expect(listActiveCanvasSandboxSessionIds()).toContain("canvas-starting");
    rejectResources(new Error("Cannot resolve resources"));
    await expect(started).rejects.toThrow("Cannot resolve resources");
    expect(listActiveCanvasSandboxSessionIds()).not.toContain("canvas-starting");
  });
});
