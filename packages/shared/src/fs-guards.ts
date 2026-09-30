import path from "node:path";
import { isWithinPath } from "./path-containment.mjs";

export { isWithinPath } from "./path-containment.mjs";

export interface WorkspacePaths {
  taskDir: string;
  envRoot: string;
}

export function normalizePath(input: string): string {
  return path.resolve(input);
}

export function assertTaskWritePath(paths: WorkspacePaths, requestedPath: string): void {
  if (!isWithinPath(paths.taskDir, requestedPath)) {
    throw new Error(`Write operation denied outside task directory: ${requestedPath}`);
  }
}

export function assertReadablePath(paths: WorkspacePaths, requestedPath: string): void {
  const allowed = isWithinPath(paths.taskDir, requestedPath) || isWithinPath(paths.envRoot, requestedPath);
  if (!allowed) {
    throw new Error(`Read operation denied outside task/env roots: ${requestedPath}`);
  }
}
