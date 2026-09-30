import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

import { query } from "../../lib/db.js";
import {
  ensureProjectCanvasFiles,
  listTaskCanvases,
  resolveCanvasFile,
  type ProjectCanvasSummary
} from "./project-canvases.js";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-canvas-"));
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

function buildCanvas(input: Partial<ProjectCanvasSummary> = {}): ProjectCanvasSummary {
  return {
    id: "canvas-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    name: "Quadratics Lab",
    slug: "quadratics-lab",
    rootPath: "canvases/quadratics-lab",
    entryPath: "index.html",
    runtimeMode: "static",
    devServer: {},
    lastTaskId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...input
  };
}

describe("project canvas files", () => {
  it("creates the canvas directory and manifest without a placeholder page", async () => {
    await ensureProjectCanvasFiles({
      environmentRootPath: tempRoot,
      name: "Quadratics Lab",
      rootPath: "canvases/quadratics-lab",
      entryPath: "index.html",
      runtimeMode: "static",
      devServer: {}
    });

    await expect(fs.stat(path.join(tempRoot, "canvases/quadratics-lab/index.html")))
      .rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readFile(path.join(tempRoot, "canvases/quadratics-lab/canvas.json"), "utf8"))
      .resolves.toContain("\"entry\": \"index.html\"");
  });

  it("serves nested files but rejects path traversal", async () => {
    await fs.mkdir(path.join(tempRoot, "canvases/quadratics-lab/assets"), { recursive: true });
    await fs.writeFile(path.join(tempRoot, "canvases/quadratics-lab/assets/app.css"), "body {}", "utf8");

    await expect(resolveCanvasFile({
      environmentRootPath: tempRoot,
      canvas: buildCanvas(),
      requestedPath: "assets/app.css"
    })).resolves.toMatchObject({
      relativePath: "assets/app.css",
      sizeBytes: 7
    });

    await expect(resolveCanvasFile({
      environmentRootPath: tempRoot,
      canvas: buildCanvas(),
      requestedPath: "../outside.txt"
    })).rejects.toThrow();
  });

  it("lists canvases created by or attached to a task", async () => {
    vi.mocked(query).mockResolvedValueOnce({
      rows: [{
        id: "canvas-1",
        workspace_id: "workspace-1",
        environment_id: "project-1",
        name: "Quadratics Lab",
        slug: "quadratics-lab",
        root_path: "canvases/quadratics-lab",
        entry_path: "index.html",
        runtime_mode: "static",
        dev_server_json: {},
        created_by: "user-1",
        last_task_id: "task-1",
        created_at: new Date(0).toISOString(),
        updated_at: new Date(0).toISOString()
      }],
      rowCount: 1
    } as never);

    await expect(listTaskCanvases("task-1")).resolves.toEqual([
      buildCanvas({ lastTaskId: "task-1" })
    ]);
    expect(vi.mocked(query)).toHaveBeenCalledWith(
      expect.stringContaining("pc.last_task_id = $1"),
      ["task-1"]
    );
  });
});
