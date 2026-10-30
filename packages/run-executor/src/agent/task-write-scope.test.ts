import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveWorkspaceStorageUnitRoot } from "@meowbert/shared";
import {
  buildTaskSandboxMounts,
  resolveApplyPatchWritableRoots,
  resolveTaskReadableMountPaths
} from "./task-write-scope.js";

const tempDirs: string[] = [];
const taskScratchDir = "/scratch/workspace-1/task-1";

function createTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createWorkspaceLayout(prefix: string): {
  storageUnitRoot: string;
  workspaceRoot: string;
  envRoot: string;
} {
  const storageUnitRoot = createTempDir(prefix);
  const workspaceRoot = path.join(storageUnitRoot, "root");
  const envRoot = path.join(storageUnitRoot, "environments", "env-1", "root");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  fs.mkdirSync(envRoot, { recursive: true });
  return {
    storageUnitRoot,
    workspaceRoot,
    envRoot
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("task write scope", () => {
  it("mounts the workspace read-only for thread tasks", async () => {
    const { storageUnitRoot, envRoot, workspaceRoot } = createWorkspaceLayout("meowbert-write-scope-");
    const skillsRootDir = createTempDir("meowbert-write-scope-skills-");

    const mounts = await buildTaskSandboxMounts({
      envRoot,
      workspaceRoot,
      taskScratchDir,
      readOnly: true,
      skillsRootDir
    });

    expect(mounts).toEqual([
      { path: storageUnitRoot, readOnly: true },
      { path: taskScratchDir },
      { path: skillsRootDir, readOnly: true, optional: true }
    ]);
  });

  it("keeps the full workspace storage unit writable for non-thread tasks", async () => {
    const { storageUnitRoot, envRoot, workspaceRoot } = createWorkspaceLayout("meowbert-write-scope-");

    const mounts = await buildTaskSandboxMounts({
      envRoot,
      workspaceRoot,
      taskScratchDir,
      readOnly: false,
      skillsRootDir: null
    });

    expect(mounts).toEqual([
      { path: storageUnitRoot },
      { path: taskScratchDir }
    ]);
  });

  it("adds the environment root mount when it lives outside the workspace storage unit", async () => {
    const { storageUnitRoot, workspaceRoot } = createWorkspaceLayout("meowbert-write-scope-");
    const envRoot = createTempDir("meowbert-external-env-");

    const mounts = await buildTaskSandboxMounts({
      envRoot,
      workspaceRoot,
      taskScratchDir,
      readOnly: false,
      skillsRootDir: null
    });

    expect(mounts).toEqual([
      { path: storageUnitRoot },
      { path: envRoot },
      { path: taskScratchDir }
    ]);
  });

  it("limits thread apply_patch writes to its scratch dir", () => {
    const { envRoot, workspaceRoot } = createWorkspaceLayout("meowbert-write-roots-");
    const taskDir = path.join(envRoot, ".meowbert", "task-runs", "worker-1");

    expect(resolveApplyPatchWritableRoots({
      taskDir,
      taskScratchDir,
      envRoot,
      workspaceRoot,
      readOnly: true
    })).toEqual([taskScratchDir]);
  });

  it("keeps full write roots for non-thread tasks", () => {
    const { envRoot, workspaceRoot } = createWorkspaceLayout("meowbert-write-roots-");
    const taskDir = path.join(envRoot, ".meowbert", "task-runs", "task-1");

    expect(resolveApplyPatchWritableRoots({
      taskDir,
      taskScratchDir,
      envRoot,
      workspaceRoot,
      readOnly: false
    })).toEqual([taskDir, taskScratchDir, envRoot, resolveWorkspaceStorageUnitRoot(workspaceRoot)]);
  });

  it("detects when an external environment root needs its own readable mount", async () => {
    const { workspaceRoot } = createWorkspaceLayout("meowbert-readable-mounts-");
    const envRoot = createTempDir("meowbert-external-env-");

    await expect(resolveTaskReadableMountPaths({
      envRoot,
      workspaceRoot
    })).resolves.toEqual([
      resolveWorkspaceStorageUnitRoot(workspaceRoot),
      envRoot
    ]);
  });

  it("adds the env root mount when the configured env path is a symlink to an external directory", async () => {
    const { storageUnitRoot, workspaceRoot, envRoot } = createWorkspaceLayout("meowbert-readable-mounts-");
    const externalEnvRoot = createTempDir("meowbert-external-env-target-");

    fs.rmSync(envRoot, { recursive: true, force: true });
    fs.symlinkSync(externalEnvRoot, envRoot);

    await expect(resolveTaskReadableMountPaths({
      envRoot,
      workspaceRoot
    })).resolves.toEqual([
      storageUnitRoot,
      envRoot
    ]);
  });
});
