export type TaskLiveSyncProvider = "onedrive" | "google-drive" | "pcloud" | "rclone";

export interface TaskLiveSyncFileSummary {
  id: string;
  provider: TaskLiveSyncProvider;
  sourceId: string;
  linkKind: "file" | "folder";
  remoteName: string;
  remoteWebUrl: string | null;
  localRelativePath: string;
  taskRelativePath: string;
  lastPulledAt: string | null;
  lastPushedAt: string | null;
  lastSyncError: string | null;
}

export interface TaskLiveSyncFileSnapshot {
  exists: boolean;
  relativePath: string;
  kind: "file" | "folder" | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  hash?: string | null;
}

export interface TaskLiveSyncRemoteSnapshot {
  itemId: string;
  kind: "file" | "folder";
  name: string;
  mimeType: string | null;
  webUrl: string | null;
  modifiedAt: string | null;
  sizeBytes: number | null;
  eTag: string | null;
  cTag: string | null;
}

export interface TaskLiveSyncStatus {
  link: {
    id: string;
    workspaceId: string;
    environmentId: string;
    taskId: string | null;
    provider: TaskLiveSyncProvider;
    sourceId: string;
    linkKind: "file" | "folder";
    remoteItemId: string;
    remoteName: string;
    remoteMimeType: string | null;
    remoteWebUrl: string | null;
    localRelativePath: string;
    syncMode: "manual";
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
  };
  status: "synced" | "local_modified" | "remote_modified" | "conflict" | "missing_local" | "missing_remote" | "error";
  local: TaskLiveSyncFileSnapshot;
  remote: TaskLiveSyncRemoteSnapshot | null;
  localChanged: boolean;
  remoteChanged: boolean;
  canPull: boolean;
  canPush: boolean;
  supportsForcePull: boolean;
  supportsForcePush: boolean;
  message: string | null;
}
