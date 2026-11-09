import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({ query: vi.fn() }));
vi.mock("../environments/environment-storage.js", () => ({ ensureEnvironmentStorageRoot: vi.fn() }));
vi.mock("../tasks/task-inline-files.js", () => ({ resolveTaskInlineFile: vi.fn() }));
vi.mock("./project-canvases.js", () => ({ createProjectCanvas: vi.fn() }));

import { query } from "../../lib/db.js";
import { ensureEnvironmentStorageRoot } from "../environments/environment-storage.js";
import { resolveTaskInlineFile } from "../tasks/task-inline-files.js";
import { copyTaskCanvasToProject } from "./copy-task-canvas.js";
import { createProjectCanvas } from "./project-canvases.js";

let root: string;
const project = { id: "project-1", workspace_id: "workspace-1", root_path: "unused" };

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-canvas-copy-"));
  vi.mocked(ensureEnvironmentStorageRoot).mockResolvedValue(path.join(root, "project"));
  vi.mocked(createProjectCanvas).mockImplementation(async (input) => {
    await fs.mkdir(path.join(root, "project", "canvases", "sampler"), { recursive: true });
    return {
      id: "canvas-1", workspaceId: input.workspaceId, projectId: input.environmentId, name: input.name, slug: "sampler",
      rootPath: "canvases/sampler", entryPath: input.entryPath ?? "index.html", lastTaskId: null, createdAt: "", updatedAt: ""
    };
  });
  vi.mocked(query).mockResolvedValue({ rows: [], rowCount: 1 } as never);
});

afterEach(async () => {
  vi.clearAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

async function writeTaskFile(relativePath: string, content: string) {
  const absolutePath = path.join(root, "task", relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content);
  return absolutePath;
}

describe("copyTaskCanvasToProject", () => {
  it("copies the page's folder so its assets come along, and links it to a task in the same project", async () => {
    const entry = await writeTaskFile("sampler/index.html", "<link href=style.css>");
    await writeTaskFile("sampler/style.css", "body{}");
    await writeTaskFile("notes.md", "task notes");
    vi.mocked(resolveTaskInlineFile).mockResolvedValue({ absolutePath: entry, relativePath: "sampler/index.html", sizeBytes: 1 });

    const canvas = await copyTaskCanvasToProject({
      taskId: "task-1", taskEnvironmentId: "project-1", relativePath: "sampler/index.html", name: null, createdByUserId: "user-1", project
    });

    const target = path.join(root, "project", "canvases", "sampler");
    expect((await fs.readdir(target)).sort()).toEqual(["index.html", "style.css"]);
    expect(createProjectCanvas).toHaveBeenCalledWith(expect.objectContaining({ name: "sampler", entryPath: "index.html" }));
    expect(canvas.lastTaskId).toBe("task-1");
  });

  it("copies only the page when it sits at the task root, and leaves other projects unlinked", async () => {
    const entry = await writeTaskFile("page.html", "<p>hi</p>");
    await writeTaskFile("notes.md", "task notes");
    vi.mocked(resolveTaskInlineFile).mockResolvedValue({ absolutePath: entry, relativePath: "page.html", sizeBytes: 1 });

    const canvas = await copyTaskCanvasToProject({
      taskId: "task-1", taskEnvironmentId: "other-project", relativePath: "page.html", name: "Demo", createdByUserId: "user-1", project
    });

    expect(await fs.readdir(path.join(root, "project", "canvases", "sampler"))).toEqual(["page.html"]);
    expect(query).not.toHaveBeenCalled();
    expect(canvas.lastTaskId).toBeNull();
  });
});
