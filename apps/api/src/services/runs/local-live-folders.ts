import { createHash } from "node:crypto";
import { buildGoogleDriveMountConfig, type LocalLiveFolder, type LocalLiveFolderConfig } from "@meowbert/shared";
import type { RunLeaseClaims } from "@meowbert/shared/run-lease-token";
import { query } from "../../lib/db.js";
import { getWorkspaceSourceConnection } from "../sources/workspace-source-connections.js";
import { resolveWorkspaceSourceAccess } from "../sources/source-access.js";
import type { WorkspaceSourceConnection } from "../sources/source-types.js";
import { RunApiForwardingError } from "./run-api-forwarding.js";

interface LiveFolderRow {
  id: string; workspace_id: string; local_relative_path: string; remote_item_id: string; user_id: string;
}

function connectionId(connection: WorkspaceSourceConnection): string {
  return createHash("sha256").update(JSON.stringify([connection.workspaceId, connection.provider,
    connection.accountId, connection.connectedAt, connection.updatedByUserId])).digest("hex");
}

async function scopedFolders(claims: RunLeaseClaims): Promise<LiveFolderRow[]> {
  const deviceId = claims.holder.startsWith("device:") ? claims.holder.slice(7) : "";
  if (!deviceId) throw new RunApiForwardingError(403, "unauthorized", "Live folders require a device lease.");
  const lease = await query<{ user_id: string }>(
    `SELECT dv.user_id FROM task_run_dispatches d
      JOIN devices dv ON dv.id = d.lease_device_id
      JOIN tasks t ON t.id = d.task_id JOIN task_runs r ON r.id = d.run_id
      JOIN workspace_members wm ON wm.workspace_id = t.workspace_id AND wm.user_id = dv.user_id
      WHERE d.run_id = $1 AND d.task_id = $2 AND d.lease_epoch = $3 AND d.lease_device_id = $4
        AND d.queue_state = 'running' AND d.lease_holder = 'device:' || dv.id::text AND d.lease_expires_at > now()
        AND d.payload_json->'executionTarget'->>'kind' = 'local'
        AND d.payload_json->'executionTarget'->>'deviceId' = dv.id::text
        AND d.payload_json->'executionTarget'->>'mode' IN ('host', 'sandbox')
        AND dv.platform = 'darwin' AND dv.revoked_at IS NULL
        AND NOT t.cancellation_requested AND t.trashed_at IS NULL AND r.ended_at IS NULL`,
    [claims.runId, claims.taskId, claims.epoch, deviceId]
  );
  const owner = lease.rows[0];
  if (!owner) throw new RunApiForwardingError(409, "lease_lost", "Live Drive folders require a current macOS local-execution lease.");
  const links = await query<Omit<LiveFolderRow, "user_id">>(
    `SELECT l.id, l.workspace_id, l.local_relative_path, l.remote_item_id
      FROM source_file_links l JOIN tasks t ON t.id = $1
      WHERE l.workspace_id = t.workspace_id AND l.environment_id = t.environment_id
        AND l.provider = 'google-drive' AND l.link_kind = 'folder'
        AND (l.task_id = t.id OR (l.task_id IS NULL
          AND (l.local_relative_path = 'context' OR l.local_relative_path LIKE 'context/%')))
      ORDER BY l.local_relative_path, l.id`, [claims.taskId]
  );
  return links.rows.map((link) => ({ ...link, user_id: owner.user_id }));
}

async function metadata(link: LiveFolderRow): Promise<LocalLiveFolder> {
  const connection = await getWorkspaceSourceConnection(link.workspace_id, "google-drive");
  if (!connection || connection.updatedByUserId !== link.user_id) {
    throw new RunApiForwardingError(403, "unauthorized", "Only the user who connected Google Drive can mount this live folder.");
  }
  return { linkId: link.id, connectionId: connectionId(connection), accountLabel: connection.accountLabel ?? "Google Drive",
    localRelativePath: link.local_relative_path };
}

export async function listLocalLiveFolders(claims: RunLeaseClaims): Promise<LocalLiveFolder[]> {
  return Promise.all((await scopedFolders(claims)).map(metadata));
}

export async function localLiveFolderConfig(claims: RunLeaseClaims, linkId: string, consentedConnectionId: string): Promise<LocalLiveFolderConfig> {
  const link = (await scopedFolders(claims)).find((entry) => entry.id === linkId);
  if (!link) throw new RunApiForwardingError(404, "unauthorized", "The live folder is not attached to this run.");
  const info = await metadata(link);
  if (info.connectionId !== consentedConnectionId) throw new RunApiForwardingError(409, "unauthorized", "The Google Drive connection changed. Consent is required again.");
  const access = await resolveWorkspaceSourceAccess({ workspaceId: link.workspace_id, provider: "google-drive" });
  if (access.connection.updatedByUserId !== link.user_id || connectionId(access.connection) !== info.connectionId) {
    throw new RunApiForwardingError(409, "unauthorized", "The Google Drive connection changed. Consent is required again.");
  }
  // Refreshing credentials can take time; do not return them after lease loss or revocation.
  const current = (await scopedFolders(claims)).find((entry) => entry.id === linkId);
  if (!current || current.remote_item_id !== link.remote_item_id) throw new RunApiForwardingError(409, "lease_lost", "The live folder was removed or changed.");
  if ((await metadata(current)).connectionId !== info.connectionId) throw new RunApiForwardingError(409, "unauthorized", "The Google Drive connection changed. Consent is required again.");
  return { ...info, config: buildGoogleDriveMountConfig({ clientId: access.settings.clientId!, clientSecret: access.settings.clientSecret!,
    tokens: access.connection.tokens, rootFolderId: link.remote_item_id }) };
}
