import fsPromises from "node:fs/promises";
import path from "node:path";
import { ensureSandboxWritablePath } from "@meowbert/shared";
import { ensureDirectoryWithinRoot } from "@meowbert/shared/server-security";
import {
  createAvailableFilePath,
  sanitizeUploadFilename,
  toIsoTimestamp
} from "../../files/file-paths.js";
import { signGoogleWorkspaceReference } from "./reference-signing.js";
import {
  decodeGoogleDriveItemReference,
  getGoogleWorkspaceReferenceExtension,
  type GoogleWorkspaceReferenceFile,
  type GoogleWorkspaceReferenceMimeType,
  type GoogleWorkspaceReferencePayload
} from "./reference-types.js";

function buildReferenceFileName(name: string, mimeType: GoogleWorkspaceReferenceMimeType): string {
  const extension = getGoogleWorkspaceReferenceExtension(mimeType);
  const safeName = sanitizeUploadFilename(name);
  const currentExtension = path.extname(safeName);
  const baseName = currentExtension ? safeName.slice(0, -currentExtension.length) : safeName;
  return `${baseName || "Untitled Google file"}${extension}`;
}

export async function createGoogleWorkspaceReferenceFile(input: {
  workspaceId: string;
  environmentId: string;
  sourceId: string;
  environmentRootPath: string;
  itemReference: string;
  name: string;
  mimeType: GoogleWorkspaceReferenceMimeType;
  webUrl: string | null;
  destinationPath?: string | null;
  createDirectories?: boolean;
}): Promise<{
  name: string;
  relativePath: string;
  sizeBytes: number;
  createdAt: string | null;
  modifiedAt: string | null;
  mimeType: GoogleWorkspaceReferenceMimeType;
  webUrl: string | null;
  reference: GoogleWorkspaceReferenceFile;
}> {
  const targetDirectory = await ensureDirectoryWithinRoot({
    rootPath: input.environmentRootPath,
    requestedPath: input.destinationPath ?? undefined,
    createDirectories: input.createDirectories
  });
  const item = decodeGoogleDriveItemReference(input.itemReference);
  const payload: GoogleWorkspaceReferencePayload = {
    version: 1,
    kind: "google_workspace_reference",
    sourceId: input.sourceId,
    provider: "google-drive",
    itemReference: input.itemReference,
    itemId: item.itemId,
    resourceKey: item.resourceKey,
    name: input.name,
    mimeType: input.mimeType,
    webUrl: input.webUrl,
    scope: {
      kind: "project",
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      taskId: null
    }
  };
  const referenceFile: GoogleWorkspaceReferenceFile = {
    ...payload,
    referenceToken: signGoogleWorkspaceReference(payload)
  };
  const destinationPath = await createAvailableFilePath(path.join(
    targetDirectory.absolutePath,
    buildReferenceFileName(input.name, input.mimeType)
  ));
  const serialized = `${JSON.stringify(referenceFile, null, 2)}\n`;

  await fsPromises.writeFile(destinationPath, serialized, {
    encoding: "utf8",
    flag: "wx"
  });
  await ensureSandboxWritablePath({
    rootPath: input.environmentRootPath,
    targetPath: destinationPath
  });

  const stats = await fsPromises.stat(destinationPath);
  return {
    name: path.basename(destinationPath),
    relativePath: path.relative(targetDirectory.rootRealPath, destinationPath).split(path.sep).join("/"),
    sizeBytes: stats.size,
    createdAt: toIsoTimestamp(stats.birthtime),
    modifiedAt: toIsoTimestamp(stats.mtime),
    mimeType: input.mimeType,
    webUrl: input.webUrl,
    reference: referenceFile
  };
}
