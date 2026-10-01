import { query } from "../../lib/db.js";
import type { SourceFileLink, SourceFileLinkKind, SourceFileLinkProvider, SourceFileLinkSummary } from "./types.js";

interface SourceFileLinkRow {
  id: string;
  workspace_id: string;
  environment_id: string;
  task_id: string | null;
  provider: SourceFileLinkProvider;
  source_id: string;
  link_kind: SourceFileLinkKind;
  remote_item_id: string;
  remote_name: string;
  remote_mime_type: string | null;
  remote_web_url: string | null;
  local_relative_path: string;
  sync_mode: "manual";
  last_synced_remote_etag: string | null;
  last_synced_remote_ctag: string | null;
  last_synced_remote_modified_at: string | null;
  last_synced_remote_size_bytes: string | number | null;
  last_synced_local_hash: string | null;
  last_synced_local_size_bytes: string | number | null;
  last_synced_local_modified_at: string | null;
  last_pulled_at: string | null;
  last_pushed_at: string | null;
  last_sync_error: string | null;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

function toNullableNumber(value: string | number | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function mapSourceFileLink(row: SourceFileLinkRow): SourceFileLink {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    environmentId: row.environment_id,
    taskId: row.task_id,
    provider: row.provider,
    sourceId: row.source_id,
    linkKind: row.link_kind,
    remoteItemId: row.remote_item_id,
    remoteName: row.remote_name,
    remoteMimeType: row.remote_mime_type,
    remoteWebUrl: row.remote_web_url,
    localRelativePath: row.local_relative_path,
    syncMode: row.sync_mode,
    lastSyncedRemoteEtag: row.last_synced_remote_etag,
    lastSyncedRemoteCtag: row.last_synced_remote_ctag,
    lastSyncedRemoteModifiedAt: row.last_synced_remote_modified_at,
    lastSyncedRemoteSizeBytes: toNullableNumber(row.last_synced_remote_size_bytes),
    lastSyncedLocalHash: row.last_synced_local_hash,
    lastSyncedLocalSizeBytes: toNullableNumber(row.last_synced_local_size_bytes),
    lastSyncedLocalModifiedAt: row.last_synced_local_modified_at,
    lastPulledAt: row.last_pulled_at,
    lastPushedAt: row.last_pushed_at,
    lastSyncError: row.last_sync_error,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const SOURCE_FILE_LINK_SELECT = `SELECT id,
       workspace_id,
       environment_id,
       task_id,
       provider,
       source_id,
       link_kind,
       remote_item_id,
       remote_name,
       remote_mime_type,
       remote_web_url,
       local_relative_path,
       sync_mode,
       last_synced_remote_etag,
       last_synced_remote_ctag,
       last_synced_remote_modified_at::text,
       last_synced_remote_size_bytes,
       last_synced_local_hash,
       last_synced_local_size_bytes,
       last_synced_local_modified_at::text,
       last_pulled_at::text,
       last_pushed_at::text,
       last_sync_error,
       created_by_user_id,
       updated_by_user_id,
       created_at::text,
       updated_at::text
  FROM source_file_links`;

export async function createSourceFileLink(input: {
  workspaceId: string;
  environmentId: string;
  taskId: string | null;
  provider: SourceFileLinkProvider;
  sourceId: string;
  linkKind: SourceFileLinkKind;
  remoteItemId: string;
  remoteName: string;
  remoteMimeType: string | null;
  remoteWebUrl: string | null;
  localRelativePath: string;
  lastSyncedRemoteEtag: string | null;
  lastSyncedRemoteCtag: string | null;
  lastSyncedRemoteModifiedAt: string | null;
  lastSyncedRemoteSizeBytes: number | null;
  lastSyncedLocalHash: string | null;
  lastSyncedLocalSizeBytes: number | null;
  lastSyncedLocalModifiedAt: string | null;
  actorUserId: string | null;
}): Promise<SourceFileLink> {
  const result = await query<SourceFileLinkRow>(
    `INSERT INTO source_file_links (
       workspace_id,
       environment_id,
       task_id,
       provider,
       source_id,
       link_kind,
       remote_item_id,
       remote_name,
       remote_mime_type,
       remote_web_url,
       local_relative_path,
       sync_mode,
       last_synced_remote_etag,
       last_synced_remote_ctag,
       last_synced_remote_modified_at,
       last_synced_remote_size_bytes,
       last_synced_local_hash,
       last_synced_local_size_bytes,
       last_synced_local_modified_at,
       last_pulled_at,
       created_by_user_id,
       updated_by_user_id
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'manual', $12, $13, $14, $15, $16, $17, $18, now(), $19, $19
     )
     RETURNING id,
               workspace_id,
               environment_id,
               task_id,
               provider,
               source_id,
               link_kind,
               remote_item_id,
               remote_name,
               remote_mime_type,
               remote_web_url,
               local_relative_path,
               sync_mode,
               last_synced_remote_etag,
               last_synced_remote_ctag,
               last_synced_remote_modified_at::text,
               last_synced_remote_size_bytes,
               last_synced_local_hash,
               last_synced_local_size_bytes,
               last_synced_local_modified_at::text,
               last_pulled_at::text,
               last_pushed_at::text,
               last_sync_error,
               created_by_user_id,
               updated_by_user_id,
               created_at::text,
               updated_at::text`,
    [
      input.workspaceId,
      input.environmentId,
      input.taskId,
      input.provider,
      input.sourceId,
      input.linkKind,
      input.remoteItemId,
      input.remoteName,
      input.remoteMimeType,
      input.remoteWebUrl,
      input.localRelativePath,
      input.lastSyncedRemoteEtag,
      input.lastSyncedRemoteCtag,
      input.lastSyncedRemoteModifiedAt,
      input.lastSyncedRemoteSizeBytes,
      input.lastSyncedLocalHash,
      input.lastSyncedLocalSizeBytes,
      input.lastSyncedLocalModifiedAt,
      input.actorUserId
    ]
  );

  return mapSourceFileLink(result.rows[0]);
}

export async function getSourceFileLinkByEnvironmentPath(
  environmentId: string,
  localRelativePath: string
): Promise<SourceFileLink | null> {
  const result = await query<SourceFileLinkRow>(
    `${SOURCE_FILE_LINK_SELECT}
      WHERE environment_id = $1
        AND local_relative_path = $2
      LIMIT 1`,
    [environmentId, localRelativePath]
  );

  return result.rows[0] ? mapSourceFileLink(result.rows[0]) : null;
}

export async function getTaskSourceFileLinkByEnvironmentPath(input: {
  taskId: string;
  workspaceId: string;
  localRelativePath: string;
}): Promise<SourceFileLink | null> {
  const result = await query<SourceFileLinkRow>(
    `${SOURCE_FILE_LINK_SELECT}
      WHERE task_id = $1
        AND workspace_id = $2
        AND local_relative_path = $3
      LIMIT 1`,
    [input.taskId, input.workspaceId, input.localRelativePath]
  );

  return result.rows[0] ? mapSourceFileLink(result.rows[0]) : null;
}

export async function listGoogleDriveFolderMountPoints(): Promise<Array<{ environmentRootPath: string; localRelativePath: string }>> {
  const result = await query<{ root_path: string; local_relative_path: string }>(
    `SELECT e.root_path, l.local_relative_path
       FROM source_file_links l
       JOIN environments e ON e.id = l.environment_id
      WHERE l.provider = 'google-drive' AND l.link_kind = 'folder'`
  );

  return result.rows.map((row) => ({ environmentRootPath: row.root_path, localRelativePath: row.local_relative_path }));
}

export async function listSourceFileLinksForEnvironmentPaths(
  environmentId: string,
  localRelativePaths: string[]
): Promise<SourceFileLink[]> {
  const uniquePaths = Array.from(new Set(localRelativePaths.map((value) => value.trim()).filter((value) => value.length > 0)));
  if (uniquePaths.length === 0) {
    return [];
  }

  const result = await query<SourceFileLinkRow>(
    `${SOURCE_FILE_LINK_SELECT}
      WHERE environment_id = $1
        AND local_relative_path = ANY($2::text[])
      ORDER BY local_relative_path ASC`,
    [environmentId, uniquePaths]
  );

  return result.rows.map(mapSourceFileLink);
}

export async function listSourceFileLinksUnderEnvironmentPaths(
  environmentId: string,
  localRelativePaths: string[]
): Promise<SourceFileLink[]> {
  const uniquePaths = Array.from(new Set(localRelativePaths.map((value) => value.trim()).filter((value) => value.length > 0)));
  if (uniquePaths.length === 0) {
    return [];
  }

  const result = await query<SourceFileLinkRow>(
    `${SOURCE_FILE_LINK_SELECT}
      WHERE environment_id = $1
        AND (local_relative_path = ANY($2::text[])
          OR EXISTS (
            SELECT 1
              FROM unnest($2::text[]) AS requested(path)
             WHERE left(local_relative_path, length(requested.path) + 1) = requested.path || '/'
          ))
      ORDER BY local_relative_path ASC`,
    [environmentId, uniquePaths]
  );

  return result.rows.map(mapSourceFileLink);
}

export async function listTaskSourceFileLinkSummaries(input: {
  taskId: string;
  workspaceId: string;
}): Promise<SourceFileLinkSummary[]> {
  const result = await query<{
    id: string;
    provider: SourceFileLinkProvider;
    source_id: string;
    link_kind: SourceFileLinkKind;
    remote_name: string;
    remote_web_url: string | null;
    local_relative_path: string;
    last_pulled_at: string | null;
    last_pushed_at: string | null;
    last_sync_error: string | null;
  }>(
    `SELECT id,
            provider,
            source_id,
            link_kind,
            remote_name,
            remote_web_url,
            local_relative_path,
            last_pulled_at::text,
            last_pushed_at::text,
            last_sync_error
       FROM source_file_links
      WHERE task_id = $1
        AND workspace_id = $2
      ORDER BY local_relative_path ASC`,
    [input.taskId, input.workspaceId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    sourceId: row.source_id,
    linkKind: row.link_kind,
    remoteName: row.remote_name,
    remoteWebUrl: row.remote_web_url,
    localRelativePath: row.local_relative_path,
    lastPulledAt: row.last_pulled_at,
    lastPushedAt: row.last_pushed_at,
    lastSyncError: row.last_sync_error
  }));
}

export async function updateSourceFileLinkSyncBaseline(input: {
  id: string;
  remoteName: string;
  remoteMimeType: string | null;
  remoteWebUrl: string | null;
  lastSyncedRemoteEtag: string | null;
  lastSyncedRemoteCtag: string | null;
  lastSyncedRemoteModifiedAt: string | null;
  lastSyncedRemoteSizeBytes: number | null;
  lastSyncedLocalHash: string | null;
  lastSyncedLocalSizeBytes: number | null;
  lastSyncedLocalModifiedAt: string | null;
  actorUserId: string | null;
  pushedAt?: string | null;
  pulledAt?: string | null;
  clearError?: boolean;
}): Promise<SourceFileLink> {
  const result = await query<SourceFileLinkRow>(
    `UPDATE source_file_links
        SET remote_name = $2,
            remote_mime_type = $3,
            remote_web_url = $4,
            last_synced_remote_etag = $5,
            last_synced_remote_ctag = $6,
            last_synced_remote_modified_at = $7,
            last_synced_remote_size_bytes = $8,
            last_synced_local_hash = $9,
            last_synced_local_size_bytes = $10,
            last_synced_local_modified_at = $11,
            last_pushed_at = COALESCE($12, last_pushed_at),
            last_pulled_at = COALESCE($13, last_pulled_at),
            last_sync_error = CASE WHEN $14 THEN NULL ELSE last_sync_error END,
            updated_by_user_id = $15,
            updated_at = now()
      WHERE id = $1
    RETURNING id,
              workspace_id,
              environment_id,
              task_id,
              provider,
              source_id,
              link_kind,
              remote_item_id,
              remote_name,
              remote_mime_type,
              remote_web_url,
              local_relative_path,
              sync_mode,
              last_synced_remote_etag,
              last_synced_remote_ctag,
              last_synced_remote_modified_at::text,
              last_synced_remote_size_bytes,
              last_synced_local_hash,
              last_synced_local_size_bytes,
              last_synced_local_modified_at::text,
              last_pulled_at::text,
              last_pushed_at::text,
              last_sync_error,
              created_by_user_id,
              updated_by_user_id,
              created_at::text,
              updated_at::text`,
    [
      input.id,
      input.remoteName,
      input.remoteMimeType,
      input.remoteWebUrl,
      input.lastSyncedRemoteEtag,
      input.lastSyncedRemoteCtag,
      input.lastSyncedRemoteModifiedAt,
      input.lastSyncedRemoteSizeBytes,
      input.lastSyncedLocalHash,
      input.lastSyncedLocalSizeBytes,
      input.lastSyncedLocalModifiedAt,
      input.pushedAt ?? null,
      input.pulledAt ?? null,
      input.clearError === true,
      input.actorUserId
    ]
  );

  return mapSourceFileLink(result.rows[0]);
}

export async function setSourceFileLinkError(input: {
  id: string;
  error: string | null;
  actorUserId: string | null;
}): Promise<void> {
  await query(
    `UPDATE source_file_links
        SET last_sync_error = $2,
            updated_by_user_id = $3,
            updated_at = now()
      WHERE id = $1`,
    [input.id, input.error, input.actorUserId]
  );
}

export async function deleteSourceFileLink(id: string): Promise<void> {
  await query(`DELETE FROM source_file_links WHERE id = $1`, [id]);
}
