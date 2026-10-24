import path from "node:path";

export function resolveTaskDir(envRoot: string, taskRootPath: string): string {
  return path.resolve(envRoot, taskRootPath);
}

export function resolveTaskInputDir(taskDir: string): string {
  return path.resolve(taskDir, "inputs");
}
