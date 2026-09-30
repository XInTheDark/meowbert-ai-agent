import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { query } from "../../lib/db.js";
import { ensureEnvironmentStorageRoot } from "../environments/environment-storage.js";
import { resolveTaskInlineFile } from "./task-inline-files.js";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

vi.mock("../environments/environment-storage.js", () => ({
  ensureEnvironmentStorageRoot: vi.fn()
}));

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("resolveTaskInlineFile", () => {
  const mockedQuery = vi.mocked(query);
  const mockedEnsureEnvironmentStorageRoot = vi.mocked(ensureEnvironmentStorageRoot);

  beforeEach(() => {
    mockedQuery.mockReset();
    mockedEnsureEnvironmentStorageRoot.mockReset();
  });

  it("resolves inline files from the canonicalized environment root instead of the stale persisted root", async () => {
    const staleEnvRoot = await createTempDir("meowbert-inline-file-stale-");
    const canonicalEnvRoot = await createTempDir("meowbert-inline-file-canonical-");
    const taskRootPath = ".meowbert/task-runs/task-1";
    const expectedFilePath = path.join(canonicalEnvRoot, taskRootPath, "html-canvas-test", "inline-preview-retry-2.html");

    await fs.mkdir(path.dirname(expectedFilePath), { recursive: true });
    await fs.writeFile(expectedFilePath, "<!doctype html><html><body>ok</body></html>");

    mockedQuery.mockResolvedValueOnce({
      command: "SELECT",
      rowCount: 1,
      oid: 0,
      fields: [],
      rows: [
        {
          environment_id: "env-1",
          workspace_id: "ws-1",
          task_root_path: taskRootPath,
          environment_root_path: staleEnvRoot
        }
      ]
    });
    mockedEnsureEnvironmentStorageRoot.mockResolvedValueOnce(canonicalEnvRoot);
    const expectedRealPath = await fs.realpath(expectedFilePath);

    await expect(resolveTaskInlineFile("task-1", "html-canvas-test/inline-preview-retry-2.html")).resolves.toEqual({
      absolutePath: expectedRealPath,
      relativePath: "html-canvas-test/inline-preview-retry-2.html",
      sizeBytes: expect.any(Number)
    });
    expect(mockedEnsureEnvironmentStorageRoot).toHaveBeenCalledWith({
      id: "env-1",
      workspace_id: "ws-1",
      root_path: staleEnvRoot
    });
  });
});
