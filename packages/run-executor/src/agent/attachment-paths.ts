import fs from "node:fs";
import path from "node:path";

export interface AttachmentRoots {
  taskInputDir: string;
  projectRoot?: string | null;
}

function isInsideRealRoot(filePath: string, root: string): boolean {
  try {
    const realRoot = fs.realpathSync(root);
    const realPath = fs.realpathSync(filePath);
    return realPath === realRoot || realPath.startsWith(`${realRoot}${path.sep}`);
  } catch (error) {
    // A missing file escapes nothing; reading it reports the failure.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
    throw error;
  }
}

// Attachment paths come from the request, so only paths inside the task's inputs or its project resolve.
export function resolveContainedAttachmentPath(attachmentPath: string, roots: AttachmentRoots): string | null {
  if (path.isAbsolute(attachmentPath) || path.win32.isAbsolute(attachmentPath)) {
    return null;
  }

  const normalizedPath = attachmentPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalizedPath.split("/").includes("..")) {
    return null;
  }

  const isInputsPath = normalizedPath === "inputs" || normalizedPath.startsWith("inputs/");
  const root = isInputsPath ? roots.taskInputDir : roots.projectRoot ?? roots.taskInputDir;
  const relativePath = isInputsPath ? normalizedPath.slice("inputs".length).replace(/^\//, "") : normalizedPath;
  const resolvedPath = path.resolve(root, relativePath);
  return isInsideRealRoot(resolvedPath, root) ? resolvedPath : null;
}
