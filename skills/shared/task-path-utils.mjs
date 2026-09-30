import path from "node:path";

export function resolveTaskPathBaseDir() {
  const configuredTaskDir = process.env.MEOWBERT_TASK_DIR?.trim() || process.env.TASK_DIR?.trim();
  if (configuredTaskDir) {
    return path.resolve(configuredTaskDir);
  }
  return path.resolve(process.cwd());
}

export function resolveTaskScopedUserPath(inputPath) {
  return path.isAbsolute(inputPath)
    ? path.normalize(inputPath)
    : path.resolve(resolveTaskPathBaseDir(), inputPath);
}
