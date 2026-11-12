import fs from "node:fs/promises";
import path from "node:path";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { isWithinPath } from "@meowbert/shared";
import { isProjectContextPath } from "@meowbert/shared/project-context";
import { fromSandboxPath } from "@meowbert/shared/docker-sandbox";
import { LIVE_SYNC_FILE_VERSIONS_DEFAULT_LIMIT, type LiveSyncFileVersionContent } from "@meowbert/shared/live-sync-file-versions";
import { LIVE_SYNC_FILE_VERSIONS_TOOL_NAME, liveSyncFileVersionsArgumentsSchema } from "../../agent-tools/index.js";
import { resolveWritableFilePathWithinRoots } from "../../agent/apply-patch.js";
import type { TaskLiveSyncFileSummary } from "../../agent/live-sync-types.js";
import { resolveApplyPatchWritableRoots } from "../../agent/task-write-scope.js";
import { parseToolArguments } from "../../agent/utils.js";
import { recordFilesWritten } from "../../agent-swarm/activity.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled } from "../utils.js";

const DEFAULT_SAVE_FOLDER = "drive-versions";

function normalizeTaskPath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

// A linked Drive file maps to itself; a path below a linked Drive folder maps to the closest folder link.
export function resolveLiveSyncVersionTarget(
  liveSyncFiles: TaskLiveSyncFileSummary[],
  requestedPath: string
): { link: TaskLiveSyncFileSummary; filePath: string | null } | { error: string } {
  const normalized = normalizeTaskPath(requestedPath);
  const driveLinks = liveSyncFiles.filter((file) => file.provider === "google-drive");
  const fileLink = driveLinks.find((file) => file.linkKind === "file" && file.taskRelativePath === normalized);
  if (fileLink) return { link: fileLink, filePath: null };

  const folderLink = driveLinks
    .filter((file) => file.linkKind === "folder" && (normalized === file.taskRelativePath || normalized.startsWith(`${file.taskRelativePath}/`)))
    .sort((left, right) => right.taskRelativePath.length - left.taskRelativePath.length)[0];
  if (!folderLink) {
    return { error: "That path is not a linked Google Drive file or inside a linked Google Drive folder. Use list_live_sync_files to see linked items." };
  }
  if (normalized === folderLink.taskRelativePath) {
    return { error: "Folders have no version history. Give the path of a file inside the folder." };
  }
  return { link: folderLink, filePath: normalized.slice(folderLink.taskRelativePath.length + 1) };
}

export function defaultVersionSavePath(version: Pick<LiveSyncFileVersionContent, "fileName" | "modifiedAt" | "versionId">): string {
  const extension = path.posix.extname(version.fileName);
  const stem = path.posix.basename(version.fileName, extension).replace(/[\\/]/g, "_") || "file";
  const stamp = version.modifiedAt
    ? version.modifiedAt.replace(/\.\d+Z$/, "Z").replace(/:/g, "-")
    : version.versionId.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${DEFAULT_SAVE_FOLDER}/${stem}@${stamp}${extension}`;
}

interface LinkMountRoots {
  taskDir: string;
  envRoot: string;
}

// Project Context links live under the project root, not the task folder; absolute paths are already mount paths.
function linkMountPaths(file: TaskLiveSyncFileSummary, roots: LinkMountRoots): string[] {
  if (path.isAbsolute(file.taskRelativePath)) return [file.taskRelativePath];
  const taskPath = path.resolve(roots.taskDir, file.taskRelativePath);
  const isProjectContextLink = file.localRelativePath === file.taskRelativePath && isProjectContextPath(file.localRelativePath);
  return isProjectContextLink ? [taskPath, path.resolve(roots.envRoot, file.localRelativePath)] : [taskPath];
}

// Writing into a mounted Drive folder would upload the copy, and a linked file path would replace the working copy.
export function findLinkedPathConflict(liveSyncFiles: TaskLiveSyncFileSummary[], roots: LinkMountRoots, absolutePaths: string[]): string | null {
  const conflict = liveSyncFiles.find((file) => linkMountPaths(file, roots).some((linkPath) => absolutePaths.some((absolutePath) => (
    file.linkKind === "folder" ? isWithinPath(linkPath, absolutePath) : linkPath === absolutePath
  ))));
  return conflict?.taskRelativePath ?? null;
}

function assertOutsideLinks(ctx: ToolDispatchContext, roots: LinkMountRoots, absolutePaths: string[]): void {
  const conflict = findLinkedPathConflict(ctx.liveSyncFiles, roots, absolutePaths);
  if (conflict) {
    throw new Error(`Can't save inside the linked item ${conflict}. Choose a save_to path outside linked Drive folders.`);
  }
}

async function realpathOrSelf(value: string): Promise<string> {
  return fs.realpath(value).catch(() => path.resolve(value));
}

async function saveVersion(ctx: ToolDispatchContext, content: LiveSyncFileVersionContent, saveTo: string | null): Promise<string> {
  const requested = saveTo?.trim() ? fromSandboxPath(saveTo.trim()) : defaultVersionSavePath(content);
  const requestedAbsolute = path.resolve(ctx.taskDir, requested);
  const roots = { taskDir: ctx.taskDir, envRoot: ctx.envRoot };
  assertOutsideLinks(ctx, roots, [requestedAbsolute]);
  const writableRoots = ctx.swarm?.run.lane
    ? [ctx.taskDir, ctx.taskScratchDir]
    : resolveApplyPatchWritableRoots({
      taskDir: ctx.taskDir,
      taskScratchDir: ctx.taskScratchDir,
      envRoot: ctx.envRoot,
      workspaceRoot: ctx.workspaceRoot,
      readOnly: ctx.readOnly
    });
  const absolutePath = await resolveWritableFilePathWithinRoots(writableRoots, requestedAbsolute);
  // The write path is resolved through real roots, so compare it against the real link roots too.
  const realRoots = { taskDir: await realpathOrSelf(ctx.taskDir), envRoot: await realpathOrSelf(ctx.envRoot) };
  assertOutsideLinks(ctx, realRoots, [absolutePath]);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  try {
    await fs.writeFile(absolutePath, Buffer.from(content.contentBase64, "base64"), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`${requested} already exists. Choose another save_to path.`);
    }
    throw error;
  }
  if (ctx.swarm?.run.lane) recordFilesWritten(ctx.swarm.run.activity, [absolutePath]);
  return path.relative(ctx.taskDir, absolutePath).split(path.sep).join("/");
}

export async function handleLiveSyncFileVersions(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(LIVE_SYNC_FILE_VERSIONS_TOOL_NAME, outputItem.arguments, liveSyncFileVersionsArgumentsSchema);
  if (!parsed.ok) return toolErrorResult(parsed.error);

  const args = parsed.value;
  const target = resolveLiveSyncVersionTarget(ctx.liveSyncFiles, args.path);
  if ("error" in target) return toolErrorResult(target.error);
  const versionId = args.version_id?.trim() || null;
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: versionId ? "Save version" : "Versions",
    inputText: versionId ? `${args.path.trim()} @ ${versionId}` : args.path.trim()
  });
  const request = { taskRelativePath: target.link.taskRelativePath, filePath: target.filePath };

  try {
    if (!versionId) {
      const result = await ctx.control.platform.liveSyncFileVersions({
        ...request,
        limit: args.limit ?? LIVE_SYNC_FILE_VERSIONS_DEFAULT_LIMIT,
        modifiedBefore: args.modified_before ? new Date(args.modified_before).toISOString() : null
      });
      return await finishBuiltinToolSuccess(ctx, execution, { path: normalizeTaskPath(args.path), ...result }, {
        eventPayload: { path: normalizeTaskPath(args.path), resultCount: result.versions.length }
      });
    }

    const content = await ctx.control.platform.liveSyncFileVersionContent({ ...request, versionId });
    const savedPath = await saveVersion(ctx, content, args.save_to ?? null);
    const { contentBase64: _content, ...summary } = content;
    return await finishBuiltinToolSuccess(ctx, execution, { savedPath, ...summary }, {
      eventPayload: { path: savedPath }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Failed to ${versionId ? "save" : "list"} file versions: ${message}`);
  }
}
