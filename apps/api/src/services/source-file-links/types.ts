export type SourceFileLinkProvider = "onedrive" | "google-drive" | "pcloud" | "rclone";
export type SourceFileLinkSyncMode = "manual";
export type SourceFileLinkKind = "file" | "folder";

export type SourceFileLinkSyncStatus =
  | "synced"
  | "local_modified"
  | "remote_modified"
  | "conflict"
  | "missing_local"
  | "missing_remote"
  | "error";

export interface SourceFileLink {
  id: string;
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
  syncMode: SourceFileLinkSyncMode;
  lastSyncedRemoteEtag: string | null;
  lastSyncedRemoteCtag: string | null;
  lastSyncedRemoteModifiedAt: string | null;
  lastSyncedRemoteSizeBytes: number | null;
  lastSyncedLocalHash: string | null;
  lastSyncedLocalSizeBytes: number | null;
  lastSyncedLocalModifiedAt: string | null;
  lastPulledAt: string | null;
  lastPushedAt: string | null;
  lastSyncError: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceFileLinkRemoteSnapshot {
  itemId: string;
  kind: SourceFileLinkKind;
  name: string;
  mimeType: string | null;
  webUrl: string | null;
  modifiedAt: string | null;
  sizeBytes: number | null;
  eTag: string | null;
  cTag: string | null;
}

export interface SourceFileLinkLocalSnapshot {
  exists: boolean;
  relativePath: string;
  kind: SourceFileLinkKind | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  hash: string | null;
}

export interface SourceFileLinkStatusDetails {
  link: SourceFileLink;
  status: SourceFileLinkSyncStatus;
  local: SourceFileLinkLocalSnapshot;
  remote: SourceFileLinkRemoteSnapshot | null;
  localChanged: boolean;
  remoteChanged: boolean;
  canPull: boolean;
  canPush: boolean;
  supportsForcePull: boolean;
  supportsForcePush: boolean;
  message: string | null;
}

export interface SourceFileLinkSummary {
  id: string;
  provider: SourceFileLinkProvider;
  sourceId: string;
  linkKind: SourceFileLinkKind;
  remoteName: string;
  remoteWebUrl: string | null;
  localRelativePath: string;
  lastPulledAt: string | null;
  lastPushedAt: string | null;
  lastSyncError: string | null;
}
