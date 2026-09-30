export type SourceProvider = "google-drive" | "onedrive" | "outlook" | "youtube" | "pcloud" | "rclone";
export type SourceFileLinkProvider = "google-drive" | "onedrive" | "pcloud" | "rclone";
export type WorkspaceSourceAttachmentMode = "file" | "note";

export interface AdminSourceProviderSettings {
  id: string;
  name: string;
  description: string;
  provider: SourceProvider;
  enabled: boolean;
  requiresAdminCredentials: boolean;
  clientId: string | null;
  clientSecret: string | null;
  hasClientId: boolean;
  hasClientSecret: boolean;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSourcesResponse {
  sources: AdminSourceProviderSettings[];
}

export interface WorkspaceSourceSummary {
  id: string;
  name: string;
  description: string;
  provider: SourceProvider;
  supportsAttachments: boolean;
  supportsLiveSync: boolean;
  attachmentMode: WorkspaceSourceAttachmentMode;
  requiresAdminCredentials: boolean;
  requiresWorkspaceConnection: boolean;
  admin: {
    enabled: boolean;
    configured: boolean;
  };
  connection: {
    connected: boolean;
    accountLabel: string | null;
    connectedAt: string | null;
    canWrite: boolean;
  };
}

export interface WorkspaceSourceListResponse {
  canManage: boolean;
  sources: WorkspaceSourceSummary[];
}

export interface WorkspaceSourceConnectStartResponse {
  authorizeUrl: string;
  expiresAt: string;
}

export interface WorkspaceSourceManualConfigResponse {
  sourceId: string;
  connected: boolean;
  accountLabel: string;
}

export interface SourceFileEntry {
  id: string;
  name: string;
  displayPath?: string | null;
  kind: "file" | "folder";
  mimeType: string | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  parentId: string | null;
}

export interface SourceFolderInfo {
  id: string | null;
  name: string;
  parentId: string | null;
}

export interface SourceSearchResponse {
  items: SourceFileEntry[];
}

export interface SourcePathResponse {
  items: SourceFileEntry[];
}

export interface SourceBrowseResponse {
  folder: SourceFolderInfo;
  items: SourceFileEntry[];
}

export interface WorkspaceSourceAttachedFile {
  kind: "file" | "directory";
  name: string;
  relativePath: string;
  sizeBytes: number | null;
  createdAt: string | null;
  modifiedAt: string | null;
  googleWorkspaceReference?: {
    direct: true;
    mimeType: string;
    webUrl: string | null;
  };
  liveSync?: {
    id: string;
    provider: SourceFileLinkProvider;
    sourceId: string;
    linkKind: "file" | "folder";
    remoteName: string;
    remoteWebUrl: string | null;
    localRelativePath: string;
    lastPulledAt: string | null;
    lastPushedAt: string | null;
    lastSyncError: string | null;
  };
}

export interface WorkspaceSourceAttachedNote {
  kind: "note";
  label: string;
  content: string;
  sizeBytes: null;
}

export type WorkspaceSourceAttachment = WorkspaceSourceAttachedFile | WorkspaceSourceAttachedNote;

export interface WorkspaceSourceAttachResponse {
  attachment: WorkspaceSourceAttachment;
}

export function isWorkspaceSourceReady(source: WorkspaceSourceSummary): boolean {
  return source.admin.enabled
    && source.admin.configured
    && (!source.requiresWorkspaceConnection || source.connection.connected);
}

export function canAttachWorkspaceSource(source: WorkspaceSourceSummary): boolean {
  return source.supportsAttachments && isWorkspaceSourceReady(source);
}

export function canUseWorkspaceSourceLiveSync(source: WorkspaceSourceSummary): boolean {
  return source.supportsLiveSync && isWorkspaceSourceReady(source) && source.connection.canWrite;
}

export function getWorkspaceSourceSetupLabel(source: WorkspaceSourceSummary): string {
  if (!source.admin.configured) {
    return source.requiresAdminCredentials ? "Set up in Admin" : "Enable in Admin";
  }
  if (!source.admin.enabled) {
    return "Disabled by Admin";
  }
  if (source.requiresWorkspaceConnection && !source.connection.connected) {
    return "Connect workspace account";
  }
  if (!source.requiresWorkspaceConnection) {
    return "Ready";
  }
  return source.connection.accountLabel?.trim() || "Connected";
}
