import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../source-file-links/service.js", () => ({
  unlinkSourceFileLinksAtMissingEnvironmentPaths: vi.fn(async () => []),
  unlinkSourceFileLinksUnderEnvironmentPaths: vi.fn()
}));
vi.mock("../files/task-upload-manifest.js", () => ({ removeTaskInputUploads: vi.fn() }));
import { removeTaskInputUploads } from "../files/task-upload-manifest.js";
import { deleteProjectFiles } from "./project-file-deletion.js";
let root: string;
beforeEach(async () => { vi.clearAllMocks(); root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "input-delete-"))); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it.each(["inputs/a.txt", "inputs"])("forgets only successfully deleted input paths: %s", async (selected) => {
  await fs.mkdir(path.join(root, "inputs"));
  await fs.writeFile(path.join(root, "inputs/a.txt"), "input");
  const result = await deleteProjectFiles({ environmentId: "project", rootPath: root, requestedPaths: [selected] });
  expect(result.deletedPaths).toEqual([selected]);
  expect(removeTaskInputUploads).toHaveBeenCalledExactlyOnceWith("project", [selected]);
  await expect(fs.stat(path.join(root, selected))).rejects.toMatchObject({ code: "ENOENT" });
});

it("keeps manifests intact if the requested deletion is refused", async () => {
  await expect(deleteProjectFiles({ environmentId: "project", rootPath: root, requestedPaths: ["../outside"] })).rejects.toThrow();
  expect(removeTaskInputUploads).not.toHaveBeenCalled();
});
