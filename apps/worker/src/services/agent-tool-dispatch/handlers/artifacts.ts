import { isWithinPath } from "@meowbert/shared";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { resolveReadablePathWithinRoots } from "@meowbert/shared/server-security";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { markTaskArtifacts, unmarkTaskArtifacts } from "../../agent/artifacts.js";
import {
  MARK_ARTIFACT_TOOL_NAME,
  markArtifactArgumentsSchema
} from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import { emitTaskEvent } from "../../runtime/events.js";
import {
  finishBuiltinToolFailure,
  finishBuiltinToolSuccess,
  startBuiltinToolExecution
} from "../events.js";
import { pushParseError } from "../state.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled } from "../utils.js";

function toWebPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

async function resolveMarkedArtifactPath(taskDir: string, filePath: string): Promise<string> {
  const trimmedPath = filePath.trim();
  if (!trimmedPath) {
    throw new Error("Artifact file paths must not be empty.");
  }

  const candidatePath = path.isAbsolute(trimmedPath)
    ? trimmedPath
    : path.resolve(taskDir, trimmedPath);

  return resolveReadablePathWithinRoots([taskDir], candidatePath);
}

async function resolveArtifactRelativePathForRemoval(taskDir: string, filePath: string): Promise<string> {
  const trimmedPath = filePath.trim();
  if (!trimmedPath) {
    throw new Error("Artifact file paths must not be empty.");
  }

  const candidatePath = path.isAbsolute(trimmedPath)
    ? path.resolve(trimmedPath)
    : path.resolve(taskDir, trimmedPath);
  const realCandidatePath = await realpath(candidatePath).catch(() => null);
  const isLexicallyInsideTaskDir = isWithinPath(taskDir, candidatePath);
  const isReallyInsideTaskDir = realCandidatePath ? isWithinPath(taskDir, realCandidatePath) : false;
  if (!isLexicallyInsideTaskDir && !isReallyInsideTaskDir) {
    throw new Error(`Artifact path is outside the task directory: ${filePath}`);
  }
  if (realCandidatePath && !isReallyInsideTaskDir) {
    throw new Error(`Artifact path escapes the task directory: ${filePath}`);
  }

  const relativePath = path.relative(taskDir, realCandidatePath ?? candidatePath);
  if (!relativePath) {
    throw new Error("Artifact file paths must identify a file inside the task directory.");
  }

  return toWebPath(relativePath);
}

function buildArtifactDownloadUrl(environmentId: string, projectRelativePath: string): string {
  return `/api/projects/${encodeURIComponent(environmentId)}/files/download?path=${encodeURIComponent(projectRelativePath)}`;
}

export async function handleMarkArtifact(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(MARK_ARTIFACT_TOOL_NAME, outputItem.arguments, markArtifactArgumentsSchema);
  if (!parsed.ok) {
    pushParseError(state, outputItem.call_id, parsed.error);
    return;
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Files",
    inputText: parsed.value.remove === true
      ? `Remove: ${parsed.value.file_paths.join(", ")}`
      : parsed.value.file_paths.join(", ")
  });

  try {
    const taskDirRealPath = await realpath(ctx.taskDir);
    if (parsed.value.remove === true) {
      const relativePaths = [...new Set(await Promise.all(parsed.value.file_paths.map(
        (filePath) => resolveArtifactRelativePathForRemoval(taskDirRealPath, filePath)
      )))];

      await unmarkTaskArtifacts(ctx.taskId, relativePaths);
      await emitTaskEvent(ctx.taskId, "artifact", {
        count: 0,
        removedCount: relativePaths.length,
        removedFiles: relativePaths.map((relativePath) => ({ relativePath }))
      });

      await finishBuiltinToolSuccess(ctx, state, execution, {
        ok: true,
        removed: true,
        artifacts: relativePaths.map((relativePath) => ({ relative_path: relativePath }))
      }, {
        eventPayload: { artifactCount: 0, removedArtifactCount: relativePaths.length },
        messagePayload: { artifact_count: 0, removed_artifact_count: relativePaths.length }
      });
      return;
    }

    const envRootRealPath = await realpath(ctx.envRoot).catch(() => path.resolve(ctx.envRoot));
    const artifactsByRelativePath = new Map<string, { relativePath: string; size: number; downloadUrl: string }>();

    for (const filePath of parsed.value.file_paths) {
      const readablePath = await resolveMarkedArtifactPath(taskDirRealPath, filePath);
      const fileStats = await stat(readablePath);
      if (!fileStats.isFile()) {
        throw new Error(`Artifact path is not a file: ${filePath}`);
      }

      const relativePath = toWebPath(path.relative(taskDirRealPath, readablePath));
      let projectRelativePath: string;
      const relativeToEnv = path.relative(envRootRealPath, readablePath);
      if (isWithinPath(envRootRealPath, readablePath)) {
        projectRelativePath = toWebPath(relativeToEnv);
      } else if (ctx.taskRootPath) {
        projectRelativePath = toWebPath(path.join(ctx.taskRootPath, relativePath));
      } else {
        projectRelativePath = relativePath;
      }
      const downloadUrl = buildArtifactDownloadUrl(ctx.environmentId, projectRelativePath);

      artifactsByRelativePath.set(relativePath, {
        relativePath,
        size: fileStats.size,
        downloadUrl
      });
    }

    const artifacts = Array.from(artifactsByRelativePath.values());
    await markTaskArtifacts(ctx.taskId, artifacts.map((artifact) => ({
      relativePath: artifact.relativePath,
      size: artifact.size
    })));
    await emitTaskEvent(ctx.taskId, "artifact", {
      count: artifacts.length,
      files: artifacts.map((artifact) => ({
        relativePath: artifact.relativePath,
        sizeBytes: artifact.size
      }))
    });

    await finishBuiltinToolSuccess(ctx, state, execution, {
      ok: true,
      artifacts: artifacts.map((artifact) => ({
        relative_path: artifact.relativePath,
        size_bytes: artifact.size,
        download_url: artifact.downloadUrl
      }))
    }, {
      eventPayload: { artifactCount: artifacts.length },
      messagePayload: { artifact_count: artifacts.length }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    const action = parsed.value.remove === true ? "unmark" : "mark";
    await finishBuiltinToolFailure(ctx, state, execution, `Failed to ${action} artifacts: ${message}`);
  }
}
