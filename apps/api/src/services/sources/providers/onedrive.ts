import { buildSourceBearerHeaders, buildStoredSourceTokens, fetchJsonOrThrow } from "../provider-http.js";
import type {
  SourceAccountProfile,
  SourceBrowseResult,
  SourceDownloadResult,
  SourceFileEntry,
  SourceProviderClient,
  SourceSearchResult,
  StoredSourceTokens
} from "../source-types.js";

const ONEDRIVE_SCOPES = ["Files.ReadWrite", "offline_access", "User.Read"].join(" ");
const MICROSOFT_AUTHORIZE_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const MICROSOFT_GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0";

type OneDriveItem = {
  id: string;
  name: string;
  size?: number;
  lastModifiedDateTime?: string;
  parentReference?: {
    id?: string | null;
    path?: string | null;
  };
  file?: { mimeType?: string } | null;
  folder?: Record<string, unknown> | null;
  "@microsoft.graph.downloadUrl"?: string;
};

function escapeODataStringLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function buildOneDriveDisplayPath(item: OneDriveItem): string | null {
  const parentPath = item.parentReference?.path?.trim();
  if (!parentPath) {
    return null;
  }

  const relativeParentPath = parentPath
    .replace(/^\/(?:me\/)?drive\/root:/, "")
    .replace(/^\/drives\/[^/]+\/root:/, "")
    .replace(/\/+$/, "");
  const pathSegments = relativeParentPath
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return ["OneDrive", ...pathSegments, item.name].join("/");
}

function normalizeOneDriveItem(item: OneDriveItem): SourceFileEntry {
  return {
    id: item.id,
    name: item.name,
    displayPath: buildOneDriveDisplayPath(item),
    kind: item.folder ? "folder" : "file",
    mimeType: item.file?.mimeType ?? null,
    sizeBytes: typeof item.size === "number" ? item.size : null,
    modifiedAt: item.lastModifiedDateTime ?? null,
    parentId: item.parentReference?.id ?? null
  };
}

async function fetchOneDriveMetadata(accessToken: string, itemId: string): Promise<OneDriveItem> {
  const url = new URL(`${MICROSOFT_GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(itemId)}`);
  url.searchParams.set("$select", "id,name,size,lastModifiedDateTime,parentReference,file,folder,@microsoft.graph.downloadUrl");
  return fetchJsonOrThrow<OneDriveItem>({
    url: url.toString(),
    headers: buildSourceBearerHeaders(accessToken),
    errorPrefix: "OneDrive metadata request failed"
  });
}

function normalizeOneDrivePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");
}

async function fetchOneDriveItemByPath(input: {
  accessToken: string;
  path: string;
  folderId?: string | null;
}): Promise<OneDriveItem | null> {
  const itemPath = normalizeOneDrivePath(input.path);
  if (!itemPath) {
    return null;
  }

  const basePath = input.folderId
    ? `${MICROSOFT_GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(input.folderId)}:/${itemPath}`
    : `${MICROSOFT_GRAPH_BASE_URL}/me/drive/root:/${itemPath}`;
  const url = new URL(basePath);
  url.searchParams.set("$select", "id,name,size,lastModifiedDateTime,parentReference,file,folder");

  const response = await fetch(url, {
    headers: buildSourceBearerHeaders(input.accessToken)
  });
  if (response.status === 404) {
    return null;
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload && typeof payload === "object" && "error" in payload
      ? (payload as Record<string, unknown>).error
      : null;
    const message = error && typeof error === "object" && !Array.isArray(error) && typeof (error as Record<string, unknown>).message === "string"
      ? (error as Record<string, unknown>).message as string
      : `HTTP ${response.status}`;
    throw new Error(`OneDrive path lookup failed: ${message}`);
  }

  return payload as OneDriveItem;
}

export const onedriveProviderClient: SourceProviderClient = {
  provider: "onedrive",
  buildAuthorizationUrl(input) {
    const url = new URL(MICROSOFT_AUTHORIZE_URL);
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", ONEDRIVE_SCOPES);
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  },
  async exchangeCode(input): Promise<StoredSourceTokens> {
    const body = new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
      scope: ONEDRIVE_SCOPES
    });
    const payload = await fetchJsonOrThrow<Record<string, unknown>>({
      url: MICROSOFT_TOKEN_URL,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      errorPrefix: "OneDrive OAuth exchange failed"
    });
    return buildStoredSourceTokens({ payload });
  },
  async refreshTokens(input): Promise<StoredSourceTokens> {
    const body = new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
      scope: ONEDRIVE_SCOPES
    });
    const payload = await fetchJsonOrThrow<Record<string, unknown>>({
      url: MICROSOFT_TOKEN_URL,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      errorPrefix: "OneDrive token refresh failed"
    });
    return buildStoredSourceTokens({ payload, fallbackRefreshToken: input.refreshToken });
  },
  async fetchAccountProfile(input): Promise<SourceAccountProfile> {
    const url = new URL(`${MICROSOFT_GRAPH_BASE_URL}/me`);
    url.searchParams.set("$select", "id,displayName,userPrincipalName");
    const payload = await fetchJsonOrThrow<{ id?: string; displayName?: string; userPrincipalName?: string }>({
      url: url.toString(),
      headers: buildSourceBearerHeaders(input.accessToken),
      errorPrefix: "OneDrive account lookup failed"
    });
    return {
      accountId: payload.id ?? null,
      accountLabel: payload.userPrincipalName ?? payload.displayName ?? null
    };
  },
  async search(input): Promise<SourceSearchResult> {
    const escapedQuery = escapeODataStringLiteral(input.query.trim());
    const url = input.folderId
      ? new URL(`${MICROSOFT_GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(input.folderId)}/search(q='${escapedQuery}')`)
      : new URL(`${MICROSOFT_GRAPH_BASE_URL}/me/drive/root/search(q='${escapedQuery}')`);
    url.searchParams.set("$top", `${input.limit ?? 50}`);
    url.searchParams.set("$select", "id,name,size,lastModifiedDateTime,parentReference,file,folder");
    const payload = await fetchJsonOrThrow<{ value?: OneDriveItem[] }>({
      url: url.toString(),
      headers: buildSourceBearerHeaders(input.accessToken),
      errorPrefix: "OneDrive search failed"
    });
    return {
      items: (payload.value ?? []).map(normalizeOneDriveItem)
    };
  },
  async resolvePath(input) {
    const item = await fetchOneDriveItemByPath({
      accessToken: input.accessToken,
      path: input.path,
      folderId: input.folderId
    });
    return {
      items: item ? [normalizeOneDriveItem(item)] : []
    };
  },
  async browse(input): Promise<SourceBrowseResult> {
    const url = input.folderId
      ? new URL(`${MICROSOFT_GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(input.folderId)}/children`)
      : new URL(`${MICROSOFT_GRAPH_BASE_URL}/me/drive/root/children`);
    url.searchParams.set("$top", `${input.limit ?? 200}`);
    url.searchParams.set("$select", "id,name,size,lastModifiedDateTime,parentReference,file,folder");
    const payload = await fetchJsonOrThrow<{ value?: OneDriveItem[] }>({
      url: url.toString(),
      headers: buildSourceBearerHeaders(input.accessToken),
      errorPrefix: "OneDrive browse failed"
    });

    const folder = input.folderId
      ? await fetchOneDriveMetadata(input.accessToken, input.folderId)
      : { id: null, name: "OneDrive", parentReference: { id: null } };

    return {
      folder: {
        id: input.folderId,
        name: folder.name,
        parentId: folder.parentReference?.id ?? null
      },
      items: (payload.value ?? []).map(normalizeOneDriveItem)
    };
  },
  async downloadFile(input): Promise<SourceDownloadResult> {
    const metadata = await fetchOneDriveMetadata(input.accessToken, input.itemId);
    if (metadata.folder) {
      throw new Error("OneDrive folders cannot be downloaded as task files.");
    }

    const response = metadata["@microsoft.graph.downloadUrl"]
      ? await fetch(metadata["@microsoft.graph.downloadUrl"])
      : await fetch(`${MICROSOFT_GRAPH_BASE_URL}/me/drive/items/${encodeURIComponent(input.itemId)}/content`, {
          headers: buildSourceBearerHeaders(input.accessToken)
        });
    if (!response.ok) {
      const payload = await response.text().catch(() => "");
      throw new Error(`OneDrive download failed: ${payload || `HTTP ${response.status}`}`);
    }

    return {
      fileName: metadata.name,
      mimeType: metadata.file?.mimeType ?? null,
      sizeBytes: typeof metadata.size === "number" ? metadata.size : null,
      modifiedAt: metadata.lastModifiedDateTime ?? null,
      response
    };
  }
};
