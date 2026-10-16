interface ToolReadableRootsInput {
  taskDir: string;
  taskScratchDir: string;
  envRoot: string;
  workspaceRoot: string;
  workflowContext?: {
    workflowTaskDir?: string | null;
  } | null;
}

export function resolveToolReadableRoots(ctx: ToolReadableRootsInput): string[] {
  const workflowTaskDir = ctx.workflowContext?.workflowTaskDir?.trim();
  return [
    ...(workflowTaskDir && workflowTaskDir.length > 0 ? [workflowTaskDir] : []),
    ctx.taskDir,
    ctx.taskScratchDir,
    ctx.envRoot,
    ctx.workspaceRoot
  ];
}
