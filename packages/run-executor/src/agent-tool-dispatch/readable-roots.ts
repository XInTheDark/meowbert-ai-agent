import path from "node:path";
interface ToolReadableRootsInput {
  liveSyncFiles?: Array<{ provider: string; linkKind: string; taskRelativePath: string }>;
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
    ctx.workspaceRoot,
    ...(ctx.liveSyncFiles ?? []).filter((file) => file.provider === "google-drive" && file.linkKind === "folder" && path.isAbsolute(file.taskRelativePath)).map((file) => file.taskRelativePath)
  ];
}
