import fs from "node:fs/promises";
import {
  resolveWorkspaceEnvironmentReadableMountPaths,
  resolveWorkspaceStorageUnitRoot,
  type TaskWorkflowType
} from "@meowbert/shared";
import type { SandboxMountPath } from "@meowbert/shared/docker-sandbox";
import type { LoadedWorkflowRunContext } from "../task-workflows/service.js";
import { resolveSwarmSharedDir } from "../task-workflows/paths.js";

interface SharedPathResolutionInput {
  envRoot: string;
  workflowType: TaskWorkflowType | null;
  workflowTaskId: string | null;
}

function normalizeWorkflowTaskId(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveTaskWritableSharedPaths(input: SharedPathResolutionInput): string[] {
  const workflowTaskId = normalizeWorkflowTaskId(input.workflowTaskId);
  if (input.workflowType !== "agent_swarm" || !workflowTaskId) {
    return [];
  }

  return [resolveSwarmSharedDir(input.envRoot, workflowTaskId)];
}

export function resolveWorkflowWritableSharedPaths(workflowContext: LoadedWorkflowRunContext | null | undefined): string[] {
  if (workflowContext?.workflowType !== "agent_swarm") {
    return [];
  }

  const sharedDir = workflowContext.swarm?.sharedDir?.trim() ?? "";
  return sharedDir.length > 0 ? [sharedDir] : [];
}

export function resolveApplyPatchWritableRoots(input: {
  taskDir: string;
  envRoot: string;
  workspaceRoot: string;
  isThreadTask: boolean;
  workflowType: TaskWorkflowType | null;
  workflowTaskId: string | null;
}): string[] {
  if (!input.isThreadTask) {
    return [
      input.taskDir,
      input.envRoot,
      resolveWorkspaceStorageUnitRoot(input.workspaceRoot)
    ];
  }

  return resolveTaskWritableSharedPaths({
    envRoot: input.envRoot,
    workflowType: input.workflowType,
    workflowTaskId: input.workflowTaskId
  });
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
  isThreadTask: boolean;
  workflowType: TaskWorkflowType | null;
  workflowTaskId: string | null;
  skillsRootDir: string | null;
}): Promise<SandboxMountPath[]> {
  const readableMountPaths = await resolveTaskReadableMountPaths({
    envRoot: input.envRoot,
    workspaceRoot: input.workspaceRoot
  });
  const writableSharedPaths = input.isThreadTask
    ? resolveTaskWritableSharedPaths({
      envRoot: input.envRoot,
      workflowType: input.workflowType,
      workflowTaskId: input.workflowTaskId
    })
    : [];

  await Promise.all(writableSharedPaths.map(async (sharedPath) => {
    await fs.mkdir(sharedPath, { recursive: true });
  }));

  return [
    ...readableMountPaths.map((mountPath) => ({
      path: mountPath,
      ...(input.isThreadTask ? { readOnly: true } : {})
    })),
    ...writableSharedPaths.map((sharedPath) => ({ path: sharedPath })),
    ...(input.skillsRootDir ? [{ path: input.skillsRootDir, readOnly: true, optional: true }] : [])
  ];
}
