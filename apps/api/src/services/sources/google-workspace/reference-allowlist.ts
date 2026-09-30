import { query } from "../../../lib/db.js";
import type { GoogleWorkspaceReferenceFile } from "./reference-types.js";

export async function upsertGoogleWorkspaceProjectReference(input: {
  reference: GoogleWorkspaceReferenceFile;
  actorUserId: string;
}): Promise<void> {
  const reference = input.reference;
  await query(
    `INSERT INTO google_workspace_project_references (
       workspace_id,
       environment_id,
       source_id,
       item_reference,
       item_id,
       resource_key,
       name,
       mime_type,
       web_url,
       reference_token,
       created_by_user_id,
       updated_by_user_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
     ON CONFLICT (environment_id, source_id, item_id)
     DO UPDATE SET item_reference = EXCLUDED.item_reference,
                   resource_key = EXCLUDED.resource_key,
                   name = EXCLUDED.name,
                   mime_type = EXCLUDED.mime_type,
                   web_url = EXCLUDED.web_url,
                   reference_token = EXCLUDED.reference_token,
                   updated_by_user_id = EXCLUDED.updated_by_user_id,
                   updated_at = now()`,
    [
      reference.scope.workspaceId,
      reference.scope.environmentId,
      reference.sourceId,
      reference.itemReference,
      reference.itemId,
      reference.resourceKey,
      reference.name,
      reference.mimeType,
      reference.webUrl,
      reference.referenceToken,
      input.actorUserId
    ]
  );
}
