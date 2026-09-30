import { buildSourceBearerHeaders } from "../provider-http.js";
import { GoogleWorkspaceProxyError } from "./proxy-errors.js";
import { decodeGoogleDriveItemReference } from "./reference-types.js";

export interface GoogleWorkspaceFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  webViewLink: string | null;
  resourceKey: string | null;
}

export async function readGoogleWorkspaceFileMetadata(input: {
  itemReference: string;
  accessToken: string;
  signal: AbortSignal;
}): Promise<GoogleWorkspaceFileMetadata> {
  const item = decodeGoogleDriveItemReference(input.itemReference);
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.itemId)}`);
  url.searchParams.set("fields", "id,name,mimeType,parents,webViewLink,resourceKey,trashed");
  url.searchParams.set("supportsAllDrives", "true");
  let response: Response;
  try {
    response = await fetch(url, {
      headers: buildSourceBearerHeaders(input.accessToken, item.resourceKey
        ? { "x-goog-drive-resource-keys": `${item.itemId}/${item.resourceKey}` }
        : {}),
      redirect: "error",
      signal: input.signal
    });
  } catch {
    throw new GoogleWorkspaceProxyError("Could not verify the Google file's folder. Please try again.", 502);
  }
  if (!response.ok) {
    throw new GoogleWorkspaceProxyError(
      "Could not access the Google file or its parent folder.",
      response.status === 403 || response.status === 404 ? 403 : 502
    );
  }
  const body = await response.json() as Partial<GoogleWorkspaceFileMetadata> & { trashed?: boolean };
  if (body.trashed || body.id !== item.itemId || typeof body.name !== "string" || typeof body.mimeType !== "string") {
    throw new GoogleWorkspaceProxyError("The Google file is unavailable.", 403);
  }
  return {
    id: body.id,
    name: body.name,
    mimeType: body.mimeType,
    parents: Array.isArray(body.parents) ? body.parents.filter((parent): parent is string => typeof parent === "string") : [],
    webViewLink: typeof body.webViewLink === "string" ? body.webViewLink : null,
    resourceKey: typeof body.resourceKey === "string" ? body.resourceKey : item.resourceKey
  };
}
