export const SOURCE_PROVIDERS = ["google-drive", "onedrive", "outlook", "youtube", "pcloud", "rclone"] as const;
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

export type SourceAttachmentMode = "file" | "note";

export interface StoredSourceTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
  tokenType: string | null;
  raw: Record<string, unknown>;
}

export interface SourceProviderSettings {
  provider: SourceProvider;
  enabled: boolean;
  clientId: string | null;
  clientSecret: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSourceConnection {
  workspaceId: string;
  provider: SourceProvider;
  tokens: StoredSourceTokens;
  accountId: string | null;
  accountLabel: string | null;
  connectedAt: string;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceSourceOauthState {
  state: string;
  workspaceId: string;
  userId: string;
  provider: SourceProvider;
  codeVerifier: string;
  browserNonceHash: string;
  returnOrigin: string;
  expiresAt: string;
  createdAt: string;
}

export interface SourceAccountProfile {
  accountId: string | null;
  accountLabel: string | null;
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

export interface SourceBrowseResult {
  folder: SourceFolderInfo;
  items: SourceFileEntry[];
}

export interface SourceSearchResult {
  items: SourceFileEntry[];
}

export interface SourcePathLookupResult {
  items: SourceFileEntry[];
}

export interface SourceDownloadResult {
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  response: Response;
}

export interface SourceProviderBaseClient {
  provider: SourceProvider;
  buildAuthorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string;
  exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    code: string;
    codeVerifier: string;
    callbackQuery?: Record<string, string | undefined>;
  }): Promise<StoredSourceTokens>;
  refreshTokens(input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<StoredSourceTokens>;
  fetchAccountProfile(input: {
    accessToken: string;
    tokens?: StoredSourceTokens;
  }): Promise<SourceAccountProfile>;
}

export interface SourceFileProviderClient extends SourceProviderBaseClient {
  search(input: {
    accessToken: string;
    tokens?: StoredSourceTokens;
    query: string;
    folderId?: string | null;
    limit?: number;
  }): Promise<SourceSearchResult>;
  browse(input: {
    accessToken: string;
    tokens?: StoredSourceTokens;
    folderId: string | null;
    limit?: number;
  }): Promise<SourceBrowseResult>;
  resolvePath(input: {
    accessToken: string;
    tokens?: StoredSourceTokens;
    path: string;
    folderId?: string | null;
  }): Promise<SourcePathLookupResult>;
  downloadFile(input: {
    accessToken: string;
    tokens?: StoredSourceTokens;
    itemId: string;
  }): Promise<SourceDownloadResult>;
}

export type SourceProviderClient = SourceFileProviderClient;

export function isSourceProvider(value: string): value is SourceProvider {
  return SOURCE_PROVIDERS.includes(value as SourceProvider);
}
