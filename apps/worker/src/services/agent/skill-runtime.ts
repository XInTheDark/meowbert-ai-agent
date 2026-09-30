import path from "node:path";

export function buildSkillRuntimeEnv(input: {
  taskDir: string;
  workspaceRoot: string;
  canvas?: {
    id: string;
    absolutePath: string;
    entryPath: string;
  } | null;
}): Record<string, string> {
  const taskDir = path.resolve(input.taskDir);
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const canvasDir = input.canvas ? path.resolve(input.canvas.absolutePath) : null;

  return {
    TASK_DIR: taskDir,
    MEOWBERT_TASK_DIR: taskDir,
    WORKSPACE_ROOT: workspaceRoot,
    MEOWBERT_WORKSPACE_ROOT: workspaceRoot,
    ...(input.canvas && canvasDir
      ? {
          CANVAS_DIR: canvasDir,
          MEOWBERT_CANVAS_DIR: canvasDir,
          CANVAS_ID: input.canvas.id,
          CANVAS_ENTRY_PATH: input.canvas.entryPath
        }
      : {})
  };
}
