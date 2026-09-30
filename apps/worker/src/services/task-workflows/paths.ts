import path from "node:path";

export function resolveSwarmSharedDir(envRoot: string, workflowTaskId: string): string {
  return path.resolve(envRoot, ".meowbert", "workflow-shared", workflowTaskId);
}
