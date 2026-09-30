import { query } from "../../../lib/db.js";
import { resolveWorkspaceSourceAccess } from "../source-access.js";
import { GoogleWorkspaceProxyError } from "./proxy-errors.js";
import { readGoogleWorkspaceFileMetadata, type GoogleWorkspaceFileMetadata } from "./folder-reference-metadata.js";
import {
  decodeGoogleDriveItemReference,
  GOOGLE_DRIVE_RESOURCE_KEY_SEPARATOR,
  isGoogleWorkspaceReferenceMimeType,
  type GoogleWorkspaceReferencePayload
} from "./reference-types.js";

interface AttachedFolder {
  environment_id: string;
  remote_item_id: string;
}

async function requireAttachedAncestor(input: {
  file: GoogleWorkspaceFileMetadata;
  folders: AttachedFolder[];
  accessToken: string;
  signal: AbortSignal;
}): Promise<AttachedFolder> {
  const roots = new Map(input.folders.map((folder) => [decodeGoogleDriveItemReference(folder.remote_item_id).itemId, folder]));
  const pending = [...input.file.parents];
  const visited = new Set([input.file.id]);
  while (pending.length && visited.size <= 64) {
    const id = pending.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const root = roots.get(id);
    const parent = await readGoogleWorkspaceFileMetadata({
      itemReference: root?.remote_item_id ?? id,
      accessToken: input.accessToken,
      signal: input.signal
    });
    if (root && parent.mimeType === "application/vnd.google-apps.folder") return root;
    pending.push(...parent.parents);
  }
  throw new GoogleWorkspaceProxyError("This Google file is not inside a live folder attached to the current Project.", 403);
}

export async function resolveGoogleWorkspaceFolderReference(input: {
  taskId: string;
  workspaceId: string;
  sourceId: string;
  itemReference: string;
}): Promise<GoogleWorkspaceReferencePayload> {
  const result = await query<AttachedFolder>(
    `SELECT l.environment_id, l.remote_item_id
       FROM tasks t
       JOIN source_file_links l
         ON l.environment_id = t.environment_id AND l.workspace_id = t.workspace_id
      WHERE t.id = $1 AND t.workspace_id = $2
        AND l.source_id = $3 AND l.provider = 'google-drive' AND l.link_kind = 'folder'
        AND (l.task_id IS NULL OR l.task_id = t.id)`,
    [input.taskId, input.workspaceId, input.sourceId]
  );
  if (!result.rows.length) {
    throw new GoogleWorkspaceProxyError("Attach this Google file or its containing folder to the current Project first.", 403);
  }
  const access = await resolveWorkspaceSourceAccess({ workspaceId: input.workspaceId, provider: "google-drive" });
  const signal = AbortSignal.timeout(15_000);
  const file = await readGoogleWorkspaceFileMetadata({ itemReference: input.itemReference, accessToken: access.accessToken, signal });
  if (!isGoogleWorkspaceReferenceMimeType(file.mimeType)) {
    throw new GoogleWorkspaceProxyError("Only Google Docs, Sheets, and Slides can use Google Workspace tools.", 400);
  }
  const folder = await requireAttachedAncestor({ file, folders: result.rows, accessToken: access.accessToken, signal });
  return {
    version: 1,
    kind: "google_workspace_reference",
    provider: "google-drive",
    sourceId: input.sourceId,
    itemReference: file.resourceKey ? `${file.id}${GOOGLE_DRIVE_RESOURCE_KEY_SEPARATOR}${file.resourceKey}` : file.id,
    itemId: file.id,
    resourceKey: file.resourceKey,
    name: file.name,
    mimeType: file.mimeType,
    webUrl: file.webViewLink,
    scope: { kind: "project", workspaceId: input.workspaceId, environmentId: folder.environment_id, taskId: null }
  };
}
