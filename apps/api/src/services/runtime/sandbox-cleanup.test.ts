import { describe, expect, it, vi } from "vitest";
import type { ManagedSandboxContainerSummary } from "@meowbert/shared/docker-sandbox";

vi.mock("./sandbox.js", () => ({ apiSandboxManager: {} }));
vi.mock("../canvases/canvas-dev-server.js", () => ({
  listActiveCanvasSandboxSessionIds: vi.fn(() => ["canvas-active"])
}));

import { cleanupApiSandboxOrphansOnce } from "./sandbox-cleanup.js";

function container(id: string, overrides: Partial<ManagedSandboxContainerSummary> = {}): ManagedSandboxContainerSummary {
  return {
    containerId: id, image: "sandbox", state: "running", status: "Up", createdAt: null,
    purpose: "shell-session", workspaceId: "workspace", environmentId: "project",
    taskId: null, runId: null, sessionId: id, parentContainerId: "api-parent", ...overrides
  };
}

describe("API sandbox cleanup after manual terminal removal", () => {
  it("removes retired terminals and orphan previews while preserving live canvases and task containers", async () => {
    const stopAndRemoveContainer = vi.fn(async () => {});
    const removed = await cleanupApiSandboxOrphansOnce({
      getCurrentContainerId: () => "api-parent",
      listManagedContainers: async () => [
        container("manual-terminal"),
        container("canvas-orphan"),
        container("canvas-active"),
        container("task-shell", { taskId: "task" }),
        container("task-run", { purpose: "task-run", taskId: "task", runId: "run" }),
        container("other-api", { parentContainerId: "another-parent" }),
        container("worker-shell", { parentContainerId: "worker-parent", taskId: "task" })
      ],
      stopAndRemoveContainer
    });
    expect(removed).toBe(2);
    expect(stopAndRemoveContainer.mock.calls).toEqual([["manual-terminal"], ["canvas-orphan"]]);
  });

  it("does not remove any sandbox when API container ownership is unknown", async () => {
    const listManagedContainers = vi.fn(async () => [container("manual-terminal")]);
    const stopAndRemoveContainer = vi.fn(async () => {});
    expect(await cleanupApiSandboxOrphansOnce({
      getCurrentContainerId: () => null, listManagedContainers, stopAndRemoveContainer
    })).toBe(0);
    expect(listManagedContainers).not.toHaveBeenCalled();
    expect(stopAndRemoveContainer).not.toHaveBeenCalled();
  });
});
