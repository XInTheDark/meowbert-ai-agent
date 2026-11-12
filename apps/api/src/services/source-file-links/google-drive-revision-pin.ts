import { buildSourceBearerHeaders } from "../sources/provider-http.js";
import { fetchGoogleDriveWithRetry, throwGoogleDriveHttpError } from "./google-drive-remote.js";
import type { DriveRequestContext } from "./google-drive-folder-query.js";
import { SourceFileLinkProviderError } from "./provider-errors.js";

const GOOGLE_DRIVE_API_BASE_URL = "https://www.googleapis.com/drive/v3";

// Google's docs say a binary version can only be downloaded while it is marked "Keep Forever".
// A refused download (400 or 403, but not a rate limit) on an unpinned version is treated as that case.
export function isUnpinnedDownloadRefusal(error: unknown): boolean {
  return error instanceof SourceFileLinkProviderError
    && (error.upstreamStatus === 400 || error.upstreamStatus === 403)
    && !/rate limit/i.test(error.message);
}

export const KEPT_FOREVER_NOTE = "Google Drive only allowed this download after the version was marked \"Keep forever\", so Drive now keeps it for good and counts it toward the owner's storage.";

// Drive documents Keep Forever as lasting: a kept version can only be downloaded or deleted afterwards,
// so this is a deliberate, persistent change and is never undone automatically.
export async function markRevisionKeepForever(context: DriveRequestContext, input: { fileId: string; revisionId: string }): Promise<void> {
  const url = `${GOOGLE_DRIVE_API_BASE_URL}/files/${encodeURIComponent(input.fileId)}/revisions/${encodeURIComponent(input.revisionId)}?fields=id`;
  const { response, payload } = await fetchGoogleDriveWithRetry({
    execute: () => fetch(url, {
      method: "PATCH",
      headers: buildSourceBearerHeaders(context.accessToken, { ...context.headers, "content-type": "application/json" }),
      body: JSON.stringify({ keepForever: true })
    }),
    maxAttempts: 3
  });
  if (!response.ok) throwGoogleDriveHttpError("Google Drive could not mark that version \"Keep forever\"", payload, response.status);
}
