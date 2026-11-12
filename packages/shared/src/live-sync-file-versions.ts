// Past versions of a file in a linked Google Drive file or folder.
export const LIVE_SYNC_FILE_VERSIONS_DEFAULT_LIMIT = 50;
export const LIVE_SYNC_FILE_VERSIONS_MAX_LIMIT = 500;
// Saved versions travel back to the run as base64, so they are capped well below the Run API's comfort zone.
export const LIVE_SYNC_FILE_VERSION_MAX_BYTES = 25 * 1024 * 1024;

export interface LiveSyncFileVersion {
  id: string;
  modifiedAt: string | null;
  modifiedBy: string | null;
  sizeBytes: number | null;
  keepForever: boolean;
  current: boolean;
}

export interface LiveSyncFileVersionList {
  fileName: string;
  mimeType: string | null;
  // Newest first.
  versions: LiveSyncFileVersion[];
  totalVersions: number;
  hasOlder: boolean;
  // Google may leave older versions of frequently edited Docs, Sheets and Slides out of the list.
  mayOmitOlderVersions: boolean;
}

export interface LiveSyncFileVersionContent {
  versionId: string;
  fileName: string;
  mimeType: string | null;
  modifiedAt: string | null;
  sizeBytes: number;
  contentBase64: string;
}
