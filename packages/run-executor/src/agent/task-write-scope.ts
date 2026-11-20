import {
  resolveWorkspaceEnvironmentReadableMountPaths,
  resolveWorkspaceSandboxRoot
} from "@meowbert/shared";
import type { SandboxMountPath } from "@meowbert/shared/docker-sandbox";

export function resolveApplyPatchWritableRoots(input: {
  taskDir: string;
  taskScratchDir: string;
  envRoot: string;
  workspaceRoot: string;
  workspaceRootIsStorageUnit?: boolean;
  readOnly: boolean;
}): string[] {
  if (!input.readOnly) {
    return [
      input.taskDir,
      input.taskScratchDir,
      input.envRoot,
      resolveWorkspaceSandboxRoot(input.workspaceRoot, input.workspaceRootIsStorageUnit)
    ];
  }

  return [input.taskScratchDir];
}

export async function resolveTaskReadableMountPaths(input: {
  envRoot: string;
  workspaceRoot: string;
  workspaceRootIsStorageUnit?: boolean;
}): Promise<string[]> {
  return resolveWorkspaceEnvironmentReadableMountPaths({
    envRoot: input.envRoot,
    workspaceRoot: input.workspaceRoot,
    workspaceRootIsStorageUnit: input.workspaceRootIsStorageUnit
  });
}

export async function buildTaskSandboxMounts(input: {
  envRoot: string;
  workspaceRoot: string;
  workspaceRootIsStorageUnit?: boolean;
  taskScratchDir: string;
  taskHistoryDir: string;
  readOnly: boolean;
  skillsRootDir: string | null;
}): Promise<SandboxMountPath[]> {
  const readableMountPaths = await resolveTaskReadableMountPaths({
    envRoot: input.envRoot,
    workspaceRoot: input.workspaceRoot,
    workspaceRootIsStorageUnit: input.workspaceRootIsStorageUnit
  });

  return [
    ...readableMountPaths.map((mountPath) => ({
      path: mountPath,
      ...(input.readOnly ? { readOnly: true } : {})
    })),
    { path: input.taskScratchDir },
    { path: input.taskHistoryDir, readOnly: true },
    ...(input.skillsRootDir ? [{ path: input.skillsRootDir, readOnly: true, optional: true }] : [])
  ];
}
