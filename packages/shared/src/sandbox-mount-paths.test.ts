import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkspaceEnvironmentReadableMountPaths } from "./sandbox-mount-paths.js";

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-sandbox-mounts-"));
  tempRoots.push(rootPath);
  return rootPath;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (rootPath) => {
    await fs.rm(rootPath, { recursive: true, force: true });
  }));
});

describe("resolveWorkspaceEnvironmentReadableMountPaths", () => {
  it("keeps only the workspace storage unit when the environment root is nested inside it", async () => {
    const storageUnitRoot = await createTempRoot();
    const workspaceRoot = path.join(storageUnitRoot, "root");
    const envRoot = path.join(storageUnitRoot, "environments", "env-1", "root");

    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(envRoot, { recursive: true });

    await expect(resolveWorkspaceEnvironmentReadableMountPaths({
      workspaceRoot,
      envRoot
    })).resolves.toEqual([storageUnitRoot]);
  });

  it("adds the environment root when it lives outside the workspace storage unit", async () => {
    const storageUnitRoot = await createTempRoot();
    const workspaceRoot = path.join(storageUnitRoot, "root");
    const envRoot = await createTempRoot();

    await fs.mkdir(workspaceRoot, { recursive: true });

    await expect(resolveWorkspaceEnvironmentReadableMountPaths({
      workspaceRoot,
      envRoot
    })).resolves.toEqual([storageUnitRoot, envRoot]);
  });

  it("adds the environment root when its path is nested but resolves through a symlink outside the workspace storage unit", async () => {
    const storageUnitRoot = await createTempRoot();
    const workspaceRoot = path.join(storageUnitRoot, "root");
    const envRoot = path.join(storageUnitRoot, "environments", "env-1", "root");
    const externalEnvRoot = await createTempRoot();

    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.mkdir(path.dirname(envRoot), { recursive: true });
    await fs.symlink(externalEnvRoot, envRoot);

    await expect(resolveWorkspaceEnvironmentReadableMountPaths({
      workspaceRoot,
      envRoot
    })).resolves.toEqual([storageUnitRoot, envRoot]);
  });
});
