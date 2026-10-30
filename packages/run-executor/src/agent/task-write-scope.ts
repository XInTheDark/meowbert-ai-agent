import {
  resolveWorkspaceEnvironmentReadableMountPaths,
  resolveWorkspaceStorageUnitRoot
} from "@meowbert/shared";
import type { SandboxMountPath } from "@meowbert/shared/docker-sandbox";

export function resolveApplyPatchWritableRoots(input: {
  taskDir: string;
  taskScratchDir: string;
  envRoot: string;
  workspaceRoot: string;
  readOnly: boolean;
}): string[] {
  if (!input.readOnly) {
    return [
      input.taskDir,
      input.taskScratchDir,
      input.envRoot,
      resolveWorkspaceStorageUnitRoot(input.workspaceRoot)
    ];
  }

  return [input.taskScratchDir];
}

export async function resolveTaskReadableMountPaths(input: {
  envRoot: string;
  workspaceRoot: string;
}): Promise<string[]> {
  return resolveWorkspaceEnvironmentReadableMountPaths({
    envRoot: input.envRoot,
    workspaceRoot: input.workspaceRoot
  });
}

export async function buildTaskSandboxMounts(input: {
  envRoot: string;
  workspaceRoot: string;
  taskScratchDir: string;
  readOnly: boolean;
  skillsRootDir: string | null;
}): Promise<SandboxMountPath[]> {
  const readableMountPaths = await resolveTaskReadableMountPaths({
    envRoot: input.envRoot,
    workspaceRoot: input.workspaceRoot
  });

  return [
    ...readableMountPaths.map((mountPath) => ({
      path: mountPath,
      ...(input.readOnly ? { readOnly: true } : {})
    })),
    { path: input.taskScratchDir },
    ...(input.skillsRootDir ? [{ path: input.skillsRootDir, readOnly: true, optional: true }] : [])
  ];
}
