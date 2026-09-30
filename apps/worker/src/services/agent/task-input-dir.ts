import { resolveTaskInputDir } from "../tasks/task-paths.js";

export function resolveAgentTaskInputDir(input: {
  taskDir: string;
  workflowTaskDir?: string | null;
}): string {
  const workflowTaskDir = input.workflowTaskDir?.trim();
  return resolveTaskInputDir(workflowTaskDir && workflowTaskDir.length > 0 ? workflowTaskDir : input.taskDir);
}
