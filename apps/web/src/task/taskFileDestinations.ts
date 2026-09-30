export const TASK_FILE_DESTINATION_PENDING_MESSAGE = "Task files are still loading. Try again in a moment.";

function normalizeTaskPath(pathValue: string | null | undefined): string | null {
  if (typeof pathValue !== "string") {
    return null;
  }

  const normalized = pathValue.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : null;
}

export function buildTaskInputsDestinationPath(taskRootPath: string | null | undefined): string | null {
  const normalizedTaskRootPath = normalizeTaskPath(taskRootPath);
  if (!normalizedTaskRootPath) {
    return null;
  }

  return `${normalizedTaskRootPath}/inputs`;
}

export function buildThreadTaskRootPath(
  parentTaskRootPath: string | null | undefined,
  threadTaskId: string | null | undefined
): string | null {
  const normalizedParentTaskRootPath = normalizeTaskPath(parentTaskRootPath);
  const normalizedThreadTaskId = normalizeTaskPath(threadTaskId);
  if (!normalizedParentTaskRootPath || !normalizedThreadTaskId) {
    return null;
  }

  return `${normalizedParentTaskRootPath}/threads/${normalizedThreadTaskId}`;
}

export function buildTaskArtifactDownloadPath(
  taskRootPath: string | null | undefined,
  artifactRelativePath: string | null | undefined
): string | null {
  const normalizedTaskRootPath = normalizeTaskPath(taskRootPath);
  const normalizedArtifactPath = normalizeTaskPath(artifactRelativePath);
  if (!normalizedTaskRootPath || !normalizedArtifactPath) {
    return null;
  }

  return `${normalizedTaskRootPath}/${normalizedArtifactPath.replace(/^\/+/, "")}`;
}

function basenameFromPath(pathValue: string): string {
  const normalized = pathValue.replace(/\\/g, "/").replace(/\/+$/, "");
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
}

export function buildTaskInputAttachmentPath(
  taskInputUploadPath: string | null | undefined,
  uploadedRelativePath: string | null | undefined,
  fallbackName: string | null | undefined
): string {
  const normalizedUploadRoot = normalizeTaskPath(taskInputUploadPath);
  const normalizedUploadedPath = normalizeTaskPath(uploadedRelativePath);

  if (normalizedUploadRoot && normalizedUploadedPath) {
    if (normalizedUploadedPath === normalizedUploadRoot) {
      const fallbackBase = fallbackName ? basenameFromPath(fallbackName) : "upload.bin";
      return `inputs/${fallbackBase}`;
    }

    const uploadRootPrefix = `${normalizedUploadRoot}/`;
    if (normalizedUploadedPath.startsWith(uploadRootPrefix)) {
      return `inputs/${normalizedUploadedPath.slice(uploadRootPrefix.length)}`;
    }
  }

  const fallbackPath = normalizeTaskPath(fallbackName) ?? basenameFromPath(normalizedUploadedPath ?? "upload.bin");
  return `inputs/${basenameFromPath(fallbackPath)}`;
}
