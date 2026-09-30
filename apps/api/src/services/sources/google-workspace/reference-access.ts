import { query } from "../../../lib/db.js";
import { verifyGoogleWorkspaceReferenceToken } from "./reference-signing.js";
import { GoogleWorkspaceProxyError } from "./proxy-errors.js";
import type { GoogleWorkspaceReferencePayload } from "./reference-types.js";
import { resolveGoogleWorkspaceFolderReference } from "./folder-reference-access.js";

interface SourceProxyTicketPayload {
  taskId: string | null;
  workspaceId: string | null;
  sourceId: string | null;
}

async function hasProjectAllowlistAccess(input: {
  taskId: string;
  workspaceId: string;
  environmentId: string;
  sourceId: string;
  itemId: string;
}): Promise<boolean> {
  const result = await query<{ allowed: boolean }>(
    `SELECT true AS allowed
       FROM tasks t
       JOIN google_workspace_project_references r
         ON r.workspace_id = t.workspace_id
        AND r.environment_id = t.environment_id
      WHERE t.id = $1
        AND t.workspace_id = $2
        AND t.environment_id = $3
        AND r.source_id = $4
        AND r.item_id = $5
      LIMIT 1`,
    [
      input.taskId,
      input.workspaceId,
      input.environmentId,
      input.sourceId,
      input.itemId
    ]
  );
  return result.rows[0]?.allowed === true;
}

export async function authorizeGoogleWorkspaceReference(input: {
  referenceToken: string;
  routeSourceId: string;
  ticket: SourceProxyTicketPayload;
}): Promise<GoogleWorkspaceReferencePayload> {
  let reference: GoogleWorkspaceReferencePayload;
  try {
    reference = verifyGoogleWorkspaceReferenceToken(input.referenceToken);
  } catch {
    throw new GoogleWorkspaceProxyError("Google Workspace reference is invalid.", 403);
  }

  if (
    !input.ticket.taskId
    || !input.ticket.workspaceId
    || input.ticket.sourceId !== input.routeSourceId
    || reference.sourceId !== input.routeSourceId
    || reference.scope.workspaceId !== input.ticket.workspaceId
  ) {
    throw new GoogleWorkspaceProxyError(
      "This Google Workspace reference is not allowed for the current Project.",
      403
    );
  }

  const directlyAttached = await hasProjectAllowlistAccess({
    taskId: input.ticket.taskId,
    workspaceId: reference.scope.workspaceId,
    environmentId: reference.scope.environmentId,
    sourceId: reference.sourceId,
    itemId: reference.itemId
  });
  if (!directlyAttached) {
    const current = await resolveGoogleWorkspaceFolderReference({
      taskId: input.ticket.taskId,
      workspaceId: input.ticket.workspaceId,
      sourceId: input.routeSourceId,
      itemReference: reference.itemReference
    });
    if (current.scope.environmentId !== reference.scope.environmentId || current.mimeType !== reference.mimeType) {
      throw new GoogleWorkspaceProxyError("This Google Workspace reference is not allowed for the current Project.", 403);
    }
    return current;
  }
  return reference;
}
