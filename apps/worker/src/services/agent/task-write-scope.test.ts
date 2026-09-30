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
import { resolveSwarmSharedDir } from "../task-workflows/paths.js";

const tempDirs: string[] = [];

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
  it("adds a writable shared swarm handoff mount for agent swarm thread tasks", async () => {
    const { storageUnitRoot, envRoot, workspaceRoot } = createWorkspaceLayout("meowbert-write-scope-");
    const skillsRootDir = createTempDir("meowbert-write-scope-skills-");
    const workflowTaskId = "workflow-1";
    const sharedDir = resolveSwarmSharedDir(envRoot, workflowTaskId);

    const mounts = await buildTaskSandboxMounts({
      envRoot,
      workspaceRoot,
      isThreadTask: true,
      workflowType: "agent_swarm",
      workflowTaskId,
      skillsRootDir
    });

    expect(mounts).toEqual([
      { path: storageUnitRoot, readOnly: true },
      { path: sharedDir },
      { path: skillsRootDir, readOnly: true, optional: true }
    ]);
    expect(fs.existsSync(sharedDir)).toBe(true);
  });

  it("keeps the full workspace storage unit writable for non-thread tasks", async () => {
    const { storageUnitRoot, envRoot, workspaceRoot } = createWorkspaceLayout("meowbert-write-scope-");

    const mounts = await buildTaskSandboxMounts({
      envRoot,
      workspaceRoot,
      isThreadTask: false,
      workflowType: null,
      workflowTaskId: null,
      skillsRootDir: null
    });

    expect(mounts).toEqual([
      { path: storageUnitRoot }
    ]);
  });

  it("keeps the full workspace storage unit writable for agent swarm workers", async () => {
    const { storageUnitRoot, envRoot, workspaceRoot } = createWorkspaceLayout("meowbert-write-scope-");

    const mounts = await buildTaskSandboxMounts({
      envRoot,
      workspaceRoot,
      isThreadTask: false,
      workflowType: "agent_swarm",
      workflowTaskId: "swarm-main",
      skillsRootDir: null
    });

    expect(mounts).toEqual([
      { path: storageUnitRoot }
    ]);
  });

  it("adds the environment root mount when it lives outside the workspace storage unit", async () => {
    const { storageUnitRoot, workspaceRoot } = createWorkspaceLayout("meowbert-write-scope-");
    const envRoot = createTempDir("meowbert-external-env-");

    const mounts = await buildTaskSandboxMounts({
      envRoot,
      workspaceRoot,
      isThreadTask: false,
      workflowType: null,
      workflowTaskId: null,
      skillsRootDir: null
    });

    expect(mounts).toEqual([
      { path: storageUnitRoot },
      { path: envRoot }
    ]);
  });

  it("limits thread apply_patch writes to the swarm shared handoff dir", () => {
    const { envRoot, workspaceRoot } = createWorkspaceLayout("meowbert-write-roots-");
    const taskDir = path.join(envRoot, ".meowbert", "task-runs", "worker-1");

    expect(resolveApplyPatchWritableRoots({
      taskDir,
      envRoot,
      workspaceRoot,
      isThreadTask: true,
      workflowType: "agent_swarm",
      workflowTaskId: "workflow-1"
    })).toEqual([
      resolveSwarmSharedDir(envRoot, "workflow-1")
    ]);
  });

  it("keeps full write roots for non-thread tasks", () => {
    const { envRoot, workspaceRoot } = createWorkspaceLayout("meowbert-write-roots-");
    const taskDir = path.join(envRoot, ".meowbert", "task-runs", "task-1");

    expect(resolveApplyPatchWritableRoots({
      taskDir,
      envRoot,
      workspaceRoot,
      isThreadTask: false,
      workflowType: "agent_swarm",
      workflowTaskId: "workflow-1"
    })).toEqual([taskDir, envRoot, resolveWorkspaceStorageUnitRoot(workspaceRoot)]);
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
