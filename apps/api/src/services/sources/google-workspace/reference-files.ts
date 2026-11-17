import path from "node:path";
import { Readable } from "node:stream";
import { resolveStorageDirectory, sanitizeUploadFilename } from "../../files/file-paths.js";
import { saveUploadedFile } from "../../files/save-uploaded-file.js";
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
  const targetDirectory = await resolveStorageDirectory(input.environmentRootPath, input.destinationPath ?? undefined);
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
  const serialized = `${JSON.stringify(referenceFile, null, 2)}\n`;
  const saved = await saveUploadedFile({
    targetDirectory,
    filename: buildReferenceFileName(input.name, input.mimeType),
    file: Readable.from([Buffer.from(serialized, "utf8")]),
    limitBytes: Number.MAX_SAFE_INTEGER,
    writable: true,
    createDirectories: input.createDirectories
  });
  const { name, relativePath, sizeBytes, createdAt, modifiedAt } = saved.file;
  return {
    name, relativePath, sizeBytes, createdAt, modifiedAt,
    mimeType: input.mimeType,
    webUrl: input.webUrl,
    reference: referenceFile
  };
}
