import { query } from "../../../lib/db.js";
import { resolveGoogleWorkspaceFolderReference } from "./folder-reference-access.js";
import { GoogleWorkspaceProxyError } from "./proxy-errors.js";
import { signGoogleWorkspaceReference, verifyGoogleWorkspaceReferenceToken } from "./reference-signing.js";
import { decodeGoogleDriveItemReference } from "./reference-types.js";

export async function resolveGoogleWorkspaceReference(input: {
  taskId: string;
  workspaceId: string;
  sourceId: string;
  itemReference: string;
}) {
  const item = decodeGoogleDriveItemReference(input.itemReference);
  if (!/^[A-Za-z0-9_-]+$/.test(item.itemId) || (item.resourceKey && !/^[A-Za-z0-9_-]+$/.test(item.resourceKey))) {
    throw new GoogleWorkspaceProxyError("The Google file ID is invalid.", 400);
  }
  const direct = await query<{ reference_token: string }>(
    `SELECT r.reference_token
       FROM tasks t
       JOIN google_workspace_project_references r
         ON r.workspace_id = t.workspace_id AND r.environment_id = t.environment_id
      WHERE t.id = $1 AND t.workspace_id = $2 AND r.source_id = $3 AND r.item_id = $4
      LIMIT 1`,
    [input.taskId, input.workspaceId, input.sourceId, item.itemId]
  );
  const reference = direct.rows[0]
    ? verifyGoogleWorkspaceReferenceToken(direct.rows[0].reference_token)
    : await resolveGoogleWorkspaceFolderReference(input);
  return {
    path: null,
    itemId: reference.itemId,
    itemReference: reference.itemReference,
    name: reference.name,
    mimeType: reference.mimeType,
    webUrl: reference.webUrl,
    referenceToken: signGoogleWorkspaceReference(reference)
  };
}
