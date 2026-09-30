import { assertSourceProviderRuntimeEnabled } from "@meowbert/shared";
import {
  createGoogleDriveRemoteFolder,
  deleteGoogleDriveRemoteItem,
  downloadGoogleDriveRemoteFile,
  fetchGoogleDriveRemoteSnapshot,
  listGoogleDriveRemoteFolderChildren,
  uploadNewGoogleDriveRemoteFile,
  uploadGoogleDriveRemoteFile
} from "./google-drive-remote.js";
import {
  createOneDriveRemoteFolder,
  deleteOneDriveRemoteItem,
  downloadOneDriveRemoteFile,
  fetchOneDriveRemoteSnapshot,
  listOneDriveRemoteFolderChildren,
  uploadNewOneDriveRemoteFile,
  uploadOneDriveRemoteFile
} from "./onedrive-remote.js";
import {
  createPCloudRemoteFolder,
  deletePCloudRemoteItem,
  downloadPCloudRemoteFile,
  fetchPCloudRemoteSnapshot,
  listPCloudRemoteFolderChildren,
  uploadNewPCloudRemoteFile,
  uploadPCloudRemoteFile
} from "./pcloud-remote.js";
import {
  createRcloneRemoteFolder,
  deleteRcloneRemoteItem,
  downloadRcloneRemoteFile,
  fetchRcloneRemoteSnapshot,
  listRcloneRemoteFolderChildren,
  uploadNewRcloneRemoteFile,
  uploadRcloneRemoteFile
} from "./rclone-remote.js";
import type { SourceFileLinkProvider, SourceFileLinkRemoteSnapshot } from "./types.js";
import type { SourceDownloadResult } from "../sources/source-types.js";

export { SourceFileLinkRemoteMissingError } from "./provider-errors.js";

export interface SourceFileLinkRemoteProviderClient {
  fetchRemoteSnapshot(input: {
    workspaceId: string;
    sourceId: string;
    itemId: string;
    requireWriteAccess?: boolean;
  }): Promise<SourceFileLinkRemoteSnapshot>;
  uploadRemoteFile(input: {
    workspaceId: string;
    sourceId: string;
    itemId: string;
    localFilePath: string;
    ifMatchEtag?: string | null;
  }): Promise<SourceFileLinkRemoteSnapshot>;
  listRemoteFolderChildren(input: {
    workspaceId: string;
    sourceId: string;
    folderItemId: string;
  }): Promise<SourceFileLinkRemoteSnapshot[]>;
  downloadRemoteFile(input: {
    workspaceId: string;
    sourceId: string;
    itemId: string;
  }): Promise<SourceDownloadResult>;
  createRemoteFolder(input: {
    workspaceId: string;
    sourceId: string;
    parentItemId: string;
    name: string;
  }): Promise<SourceFileLinkRemoteSnapshot>;
  uploadNewRemoteFile(input: {
    workspaceId: string;
    sourceId: string;
    parentItemId: string;
    localFilePath: string;
    name: string;
  }): Promise<SourceFileLinkRemoteSnapshot>;
  deleteRemoteItem(input: {
    workspaceId: string;
    sourceId: string;
    itemId: string;
  }): Promise<void>;
}

const remoteProviders: Record<SourceFileLinkProvider, SourceFileLinkRemoteProviderClient> = {
  "google-drive": {
    fetchRemoteSnapshot: fetchGoogleDriveRemoteSnapshot,
    uploadRemoteFile: uploadGoogleDriveRemoteFile,
    listRemoteFolderChildren: listGoogleDriveRemoteFolderChildren,
    downloadRemoteFile: downloadGoogleDriveRemoteFile,
    createRemoteFolder: createGoogleDriveRemoteFolder,
    uploadNewRemoteFile: uploadNewGoogleDriveRemoteFile,
    deleteRemoteItem: deleteGoogleDriveRemoteItem
  },
  onedrive: {
    fetchRemoteSnapshot: fetchOneDriveRemoteSnapshot,
    uploadRemoteFile: uploadOneDriveRemoteFile,
    listRemoteFolderChildren: listOneDriveRemoteFolderChildren,
    downloadRemoteFile: downloadOneDriveRemoteFile,
    createRemoteFolder: createOneDriveRemoteFolder,
    uploadNewRemoteFile: uploadNewOneDriveRemoteFile,
    deleteRemoteItem: deleteOneDriveRemoteItem
  },
  pcloud: {
    fetchRemoteSnapshot: fetchPCloudRemoteSnapshot,
    uploadRemoteFile: uploadPCloudRemoteFile,
    listRemoteFolderChildren: listPCloudRemoteFolderChildren,
    downloadRemoteFile: downloadPCloudRemoteFile,
    createRemoteFolder: createPCloudRemoteFolder,
    uploadNewRemoteFile: uploadNewPCloudRemoteFile,
    deleteRemoteItem: deletePCloudRemoteItem
  },
  rclone: {
    fetchRemoteSnapshot: fetchRcloneRemoteSnapshot,
    uploadRemoteFile: uploadRcloneRemoteFile,
    listRemoteFolderChildren: listRcloneRemoteFolderChildren,
    downloadRemoteFile: downloadRcloneRemoteFile,
    createRemoteFolder: createRcloneRemoteFolder,
    uploadNewRemoteFile: uploadNewRcloneRemoteFile,
    deleteRemoteItem: deleteRcloneRemoteItem
  }
};

export function getSourceFileLinkRemoteProvider(provider: SourceFileLinkProvider): SourceFileLinkRemoteProviderClient {
  assertSourceProviderRuntimeEnabled(provider);
  return remoteProviders[provider];
}
