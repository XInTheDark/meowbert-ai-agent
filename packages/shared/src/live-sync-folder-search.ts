export const LIVE_SYNC_FOLDER_SEARCH_FILE_TYPES = [
  "folder", "document", "spreadsheet", "presentation", "form", "drawing", "pdf", "image", "video", "audio", "text"
] as const;
export const LIVE_SYNC_FOLDER_SEARCH_MATCHES = ["full_text", "name", "exact_name"] as const;
export const LIVE_SYNC_FOLDER_SEARCH_ORDERS = ["relevance", "modified_desc", "modified_asc", "created_desc", "name"] as const;
export const LIVE_SYNC_FOLDER_SEARCH_MAX_LIMIT = 100;
export const LIVE_SYNC_FOLDER_SEARCH_MAX_DEPTH = 100;

export type LiveSyncFolderSearchFileType = typeof LIVE_SYNC_FOLDER_SEARCH_FILE_TYPES[number];
export type LiveSyncFolderSearchMatch = typeof LIVE_SYNC_FOLDER_SEARCH_MATCHES[number];
export type LiveSyncFolderSearchOrder = typeof LIVE_SYNC_FOLDER_SEARCH_ORDERS[number];
