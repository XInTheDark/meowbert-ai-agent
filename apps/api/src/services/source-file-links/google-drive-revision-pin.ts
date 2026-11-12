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

async function setKeepForever(context: DriveRequestContext, input: { fileId: string; revisionId: string; keepForever: boolean }): Promise<void> {
  const url = `${GOOGLE_DRIVE_API_BASE_URL}/files/${encodeURIComponent(input.fileId)}/revisions/${encodeURIComponent(input.revisionId)}?fields=id`;
  const { response, payload } = await fetchGoogleDriveWithRetry({
    execute: () => fetch(url, {
      method: "PATCH",
      headers: buildSourceBearerHeaders(context.accessToken, { ...context.headers, "content-type": "application/json" }),
      body: JSON.stringify({ keepForever: input.keepForever })
    }),
    maxAttempts: 3
  });
  if (!response.ok) {
    throwGoogleDriveHttpError(input.keepForever ? "Google Drive could not pin that version" : "Google Drive could not unpin that version", payload, response.status);
  }
}

// Pins the version for one download and removes the pin afterwards. If the pin can't be removed,
// the download still succeeds and the warning says so, since the copy is already in hand.
export async function withTemporaryKeepForever<T>(
  context: DriveRequestContext,
  input: { fileId: string; revisionId: string },
  run: () => Promise<T>
): Promise<{ value: T; warning: string | null }> {
  await setKeepForever(context, { ...input, keepForever: true });
  let value: T;
  try {
    value = await run();
  } catch (error) {
    await setKeepForever(context, { ...input, keepForever: false }).catch(() => undefined);
    throw error;
  }
  try {
    await setKeepForever(context, { ...input, keepForever: false });
    return { value, warning: null };
  } catch {
    return {
      value,
      warning: "Google Drive needed this version marked \"Keep forever\" to download it, and the mark couldn't be removed afterwards. Remove it in the file's version history in Google Drive if it isn't wanted."
    };
  }
}
