import { getSourceCatalogEntry } from "./source-catalog.js";
import { importWorkspaceSourceFileToEnvironment } from "./file-import.js";
import { createYoutubeMetadataNoteAttachment } from "./youtube-metadata.js";
import { createLiveSyncSourceAttachment } from "../source-file-links/service.js";
import { fetchGoogleDriveRemoteSnapshot } from "../source-file-links/google-drive-remote.js";
import type { SourceFileLinkSummary } from "../source-file-links/types.js";
import { createGoogleWorkspaceReferenceFile } from "./google-workspace/reference-files.js";
import { upsertGoogleWorkspaceProjectReference } from "./google-workspace/reference-allowlist.js";
import { isGoogleWorkspaceReferenceMimeType } from "./google-workspace/reference-types.js";
import {
  assertWorkspaceStorageAvailable,
  recordWorkspaceBytesAdded,
  resolveAvailableWorkspaceBytes
} from "../workspaces/workspace-storage-allowance.js";

export type WorkspaceSourceAttachment =
  | {
      kind: "file";
      name: string;
      relativePath: string;
      sizeBytes: number | null;
      createdAt: string | null;
      modifiedAt: string | null;
      liveSync?: SourceFileLinkSummary;
      googleWorkspaceReference?: {
        direct: true;
        mimeType: string;
        webUrl: string | null;
      };
    }
  | {
      kind: "directory";
      name: string;
      relativePath: string;
      sizeBytes: number | null;
      createdAt: string | null;
      modifiedAt: string | null;
      liveSync?: SourceFileLinkSummary;
    }
  | {
      kind: "note";
      label: string;
      content: string;
      sizeBytes: null;
    };

export type WorkspaceSourceFileMode = "copy" | "live_sync";
export type GoogleWorkspaceAttachmentMode = "office" | "direct";

function requireSourceCatalogEntry(sourceId: string) {
  const source = getSourceCatalogEntry(sourceId);
  if (!source) {
    throw new Error(`Source not found: ${sourceId}`);
  }
  return source;
}

export async function attachWorkspaceSource(input: {
  workspaceId: string;
  sourceId: string;
  actorUserId: string;
  environmentRootPath?: string | null;
  workspaceRootPath?: string | null;
  environmentId?: string | null;
  itemId?: string | null;
  url?: string | null;
  destinationPath?: string | null;
  createDirectories?: boolean;
  fileMode?: WorkspaceSourceFileMode;
  googleWorkspaceMode?: GoogleWorkspaceAttachmentMode;
  taskId?: string | null;
}): Promise<WorkspaceSourceAttachment> {
  const source = requireSourceCatalogEntry(input.sourceId);

  if (source.attachmentMode === "note") {
    const normalizedUrl = input.url?.trim();
    if (!normalizedUrl) {
      throw new Error("A URL is required to attach this source.");
    }

    if (source.provider === "youtube") {
      const note = await createYoutubeMetadataNoteAttachment({ url: normalizedUrl });
      return {
        kind: "note",
        label: note.label,
        content: note.content,
        sizeBytes: null
      };
    }

    throw new Error(`Source ${source.manifest.name} does not support note attachments.`);
  }

  if (!input.environmentRootPath || !input.workspaceRootPath) {
    throw new Error("This source attachment requires a project destination.");
  }
  if (!input.environmentId) {
    throw new Error("This source attachment requires a project.");
  }
  if (!input.itemId?.trim()) {
    throw new Error("A source item is required.");
  }

  if (input.googleWorkspaceMode === "direct") {
    if (source.provider !== "google-drive") {
      throw new Error("Direct Google Workspace attachments require the Google Drive source.");
    }

    const remote = await fetchGoogleDriveRemoteSnapshot({
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      itemId: input.itemId.trim(),
      requireWriteAccess: true
    });
    if (remote.kind !== "file" || !isGoogleWorkspaceReferenceMimeType(remote.mimeType)) {
      throw new Error("Only native Google Docs, Sheets, and Slides files can be attached directly.");
    }

    const file = await createGoogleWorkspaceReferenceFile({
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      sourceId: input.sourceId,
      environmentRootPath: input.environmentRootPath,
      itemReference: input.itemId.trim(),
      name: remote.name,
      mimeType: remote.mimeType,
      webUrl: remote.webUrl,
      destinationPath: input.destinationPath ?? null,
      createDirectories: input.createDirectories
    });
    await upsertGoogleWorkspaceProjectReference({
      reference: file.reference,
      actorUserId: input.actorUserId
    });

    return {
      kind: "file",
      name: file.name,
      relativePath: file.relativePath,
      sizeBytes: file.sizeBytes,
      createdAt: file.createdAt,
      modifiedAt: file.modifiedAt,
      googleWorkspaceReference: {
        direct: true,
        mimeType: file.mimeType,
        webUrl: file.webUrl
      }
    };
  }

  const fileMode = input.fileMode ?? "copy";
  if (fileMode === "live_sync") {
    if (!source.supportsLiveSync) {
      throw new Error(`${source.manifest.name} does not support live sync attachments.`);
    }

    return createLiveSyncSourceAttachment({
      workspaceId: input.workspaceId,
      environmentId: input.environmentId,
      environmentRootPath: input.environmentRootPath,
      workspaceRootPath: input.workspaceRootPath,
      actorUserId: input.actorUserId,
      sourceId: input.sourceId,
      itemId: input.itemId.trim(),
      taskId: input.taskId ?? null,
      destinationPath: input.destinationPath ?? null,
      createDirectories: input.createDirectories
    });
  }

  const storage = input.workspaceRootPath
    ? { workspaceId: input.workspaceId, workspaceRootPath: input.workspaceRootPath, actorUserId: input.actorUserId }
    : null;
  const availableBytes = storage ? await resolveAvailableWorkspaceBytes(storage) : null;
  assertWorkspaceStorageAvailable(availableBytes, 0);
  const file = await importWorkspaceSourceFileToEnvironment({
    workspaceId: input.workspaceId,
    environmentRootPath: input.environmentRootPath,
    sourceId: input.sourceId,
    itemId: input.itemId.trim(),
    destinationPath: input.destinationPath ?? null,
    createDirectories: input.createDirectories,
    onSaved: (sizeBytes) => assertWorkspaceStorageAvailable(availableBytes, sizeBytes)
  });
  recordWorkspaceBytesAdded(input.workspaceId, file.sizeBytes ?? 0);

  return {
    kind: "file",
    name: file.name,
    relativePath: file.relativePath,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt,
    modifiedAt: file.modifiedAt
  };
}
