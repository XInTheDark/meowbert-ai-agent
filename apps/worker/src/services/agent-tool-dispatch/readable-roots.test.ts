import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openReadablePathWithinRoots } from "@meowbert/shared/server-security";
import { describe, expect, it } from "vitest";
import { resolveToolReadableRoots } from "./readable-roots.js";

describe("resolveToolReadableRoots", () => {
  it("reads workspace task-run files outside the current project but rejects other workspaces", async () => {
    const storage = await fs.mkdtemp(path.join(os.tmpdir(), "viewer-roots-"));
    try {
      const workspaceRoot = path.join(storage, "onedrive-main/workspaces/workspace-1/root");
      const envRoot = path.join(storage, "projects/project-1/root");
      const taskDir = path.join(envRoot, ".meowbert/task-runs/current-task");
      const imagePath = path.join(workspaceRoot, ".meowbert/task-runs/previous-task/pages/page-10.jpg");
      const outside = path.join(storage, "onedrive-main/workspaces/workspace-2/root/private.jpg");
      await fs.mkdir(taskDir, { recursive: true });
      await fs.mkdir(path.dirname(imagePath), { recursive: true });
      await fs.mkdir(path.dirname(outside), { recursive: true });
      await fs.writeFile(imagePath, "image bytes");
      await fs.writeFile(outside, "private");
      const roots = resolveToolReadableRoots({ taskDir, envRoot, workspaceRoot });
      const opened = await openReadablePathWithinRoots(roots, imagePath);
      try {
        expect(await opened.fileHandle.readFile("utf8")).toBe("image bytes");
      } finally {
        await opened.fileHandle.close();
      }
      await expect(openReadablePathWithinRoots(roots, outside)).rejects.toThrow("outside allowed roots");
      const escaped = path.join(workspaceRoot, "escaped.jpg");
      await fs.symlink(outside, escaped);
      await expect(openReadablePathWithinRoots(roots, escaped)).rejects.toThrow("outside allowed roots");
    } finally {
      await fs.rm(storage, { recursive: true, force: true });
    }
  });

  it("tries the workflow task dir before the worker task dir", () => {
    expect(resolveToolReadableRoots({
      taskDir: "/tmp/env/.meowbert/task-runs/worker-1",
      envRoot: "/tmp/env",
      workspaceRoot: "/tmp/workspace",
      workflowContext: {
        workflowTaskDir: "/tmp/env/.meowbert/task-runs/swarm-main"
      }
    })).toEqual([
      "/tmp/env/.meowbert/task-runs/swarm-main",
      "/tmp/env/.meowbert/task-runs/worker-1",
      "/tmp/env",
      "/tmp/workspace"
    ]);
  });
});
