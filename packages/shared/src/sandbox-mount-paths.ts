import fs from "node:fs/promises";
import path from "node:path";
import { isWithinPath } from "./fs-guards.js";
import { resolveWorkspaceStorageUnitRoot } from "./xfs-project-quota.js";

async function tryRealpath(targetPath: string): Promise<string | null> {
  try {
    return await fs.realpath(targetPath);
  } catch {
    return null;
  }
}

export async function resolveWorkspaceEnvironmentReadableMountPaths(input: {
  workspaceRoot: string;
  envRoot: string;
}): Promise<string[]> {
  const workspaceStorageUnitRoot = path.resolve(resolveWorkspaceStorageUnitRoot(input.workspaceRoot));
  const envRoot = path.resolve(input.envRoot);
  if (workspaceStorageUnitRoot === envRoot) {
    return [workspaceStorageUnitRoot];
  }

  const lexicalCoverage = isWithinPath(workspaceStorageUnitRoot, envRoot);
  if (!lexicalCoverage) {
    return [workspaceStorageUnitRoot, envRoot];
  }

  const [workspaceStorageUnitRealPath, envRootRealPath] = await Promise.all([
    tryRealpath(workspaceStorageUnitRoot),
    tryRealpath(envRoot)
  ]);
  const realCoverage =
    workspaceStorageUnitRealPath && envRootRealPath
      ? isWithinPath(workspaceStorageUnitRealPath, envRootRealPath)
      : true;

  return realCoverage ? [workspaceStorageUnitRoot] : [workspaceStorageUnitRoot, envRoot];
}
