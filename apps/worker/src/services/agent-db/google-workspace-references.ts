import { query } from "../../lib/db.js";
import type { GoogleWorkspaceRuntimeReference } from "../agent/google-workspace-references.js";

export async function hasTaskGoogleWorkspaceFolders(input: {
  taskId: string;
  workspaceId: string;
  environmentId: string;
}): Promise<boolean> {
  const result = await query<{ available: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM source_file_links
        WHERE workspace_id = $1 AND environment_id = $2
          AND provider = 'google-drive' AND link_kind = 'folder'
          AND (task_id IS NULL OR task_id = $3)
     ) AS available`,
    [input.workspaceId, input.environmentId, input.taskId]
  );
  return result.rows[0]?.available === true;
}

export async function listProjectGoogleWorkspaceReferences(input: {
  workspaceId: string;
  environmentId: string;
}): Promise<GoogleWorkspaceRuntimeReference[]> {
  const result = await query<{
    item_id: string;
    item_reference: string;
    name: string;
    mime_type: string;
    web_url: string | null;
    reference_token: string;
  }>(
    `SELECT item_id,
            item_reference,
            name,
            mime_type,
            web_url,
            reference_token
       FROM google_workspace_project_references
      WHERE workspace_id = $1
        AND environment_id = $2
      ORDER BY name ASC, item_id ASC`,
    [input.workspaceId, input.environmentId]
  );

  return result.rows.map((row) => ({
    path: null,
    itemId: row.item_id,
    itemReference: row.item_reference,
    name: row.name,
    mimeType: row.mime_type,
    webUrl: row.web_url,
    referenceToken: row.reference_token
  }));
}
