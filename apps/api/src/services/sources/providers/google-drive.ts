import { buildSourceBearerHeaders, buildStoredSourceTokens, fetchJsonOrThrow } from "../provider-http.js";
import {
  getGoogleWorkspaceExport,
  isGoogleWorkspaceMimeType
} from "../google-drive-file-types.js";
import type {
  SourceAccountProfile,
  SourceBrowseResult,
  SourceDownloadResult,
  SourceFileEntry,
  SourceProviderClient,
  SourceSearchResult,
  StoredSourceTokens
} from "../source-types.js";

const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_API_BASE_URL = "https://www.googleapis.com/drive/v3";
const GOOGLE_DRIVE_URL_HOSTS = new Set([
  "drive.google.com",
  "docs.google.com"
]);
const GOOGLE_DRIVE_RESOURCE_KEY_SEPARATOR = "::resourceKey::";

type GoogleDriveItem = {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  parents?: string[];
  driveId?: string;
};

function escapeGoogleQueryLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function buildGoogleDriveSearchTextQuery(query: string): string {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 0);

  const fullTextClauses = terms
    .map((term) => `fullText contains '${escapeGoogleQueryLiteral(term)}'`)
    .join(" and ");
  return `(name contains '${escapeGoogleQueryLiteral(terms.join(" "))}' or (${fullTextClauses}))`;
}

function encodeGoogleDriveItemReference(itemId: string, resourceKey: string | null): string {
  if (!resourceKey) {
    return itemId;
  }

  return `${itemId}${GOOGLE_DRIVE_RESOURCE_KEY_SEPARATOR}${resourceKey}`;
}

function decodeGoogleDriveItemReference(value: string): { itemId: string; resourceKey: string | null } {
  const [itemId, resourceKey] = value.split(GOOGLE_DRIVE_RESOURCE_KEY_SEPARATOR, 2);
  return {
    itemId: itemId ?? value,
    resourceKey: resourceKey?.trim() || null
  };
}

function buildGoogleDriveResourceKeyHeader(input: { itemId: string; resourceKey: string | null }): Record<string, string> {
  if (!input.resourceKey) {
    return {};
  }

  return {
    "x-goog-drive-resource-keys": `${input.itemId}/${input.resourceKey}`
  };
}

function extractGoogleDriveItemReferenceFromUrl(value: string): { itemId: string; resourceKey: string | null } | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }

  if (!GOOGLE_DRIVE_URL_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  const queryId = url.searchParams.get("id")?.trim();
  const resourceKey = url.searchParams.get("resourcekey")?.trim() || null;
  if (queryId) {
    return {
      itemId: queryId,
      resourceKey
    };
  }

  const pathSegments = url.pathname.split("/").filter((segment) => segment.length > 0);
  const markerIndex = pathSegments.findIndex((segment) => segment === "d" || segment === "folders");
  if (markerIndex >= 0) {
    const itemId = pathSegments[markerIndex + 1];
    return itemId
      ? {
          itemId,
          resourceKey
        }
      : null;
  }

  return null;
}

function normalizeGoogleDriveItem(
  item: GoogleDriveItem,
  itemReferenceId?: string,
  displayPath?: string | null
): SourceFileEntry {
  return {
    id: itemReferenceId ?? item.id,
    name: item.name,
    displayPath: displayPath ?? null,
    kind: item.mimeType === "application/vnd.google-apps.folder" ? "folder" : "file",
    mimeType: item.mimeType ?? null,
    sizeBytes: typeof item.size === "string" && item.size.length > 0 ? Number.parseInt(item.size, 10) : null,
    modifiedAt: item.modifiedTime ?? null,
    parentId: Array.isArray(item.parents) && item.parents.length > 0 ? item.parents[0] ?? null : null
  };
}

async function fetchGoogleDriveMetadata(accessToken: string, itemId: string): Promise<GoogleDriveItem> {
  const itemReference = decodeGoogleDriveItemReference(itemId);
  const url = new URL(`${GOOGLE_API_BASE_URL}/files/${encodeURIComponent(itemReference.itemId)}`);
  url.searchParams.set("fields", "id,name,mimeType,size,modifiedTime,parents,driveId");
  url.searchParams.set("supportsAllDrives", "true");
  return fetchJsonOrThrow<GoogleDriveItem>({
    url: url.toString(),
    headers: buildSourceBearerHeaders(accessToken, buildGoogleDriveResourceKeyHeader(itemReference)),
    errorPrefix: "Google Drive metadata request failed"
  });
}

async function fetchGoogleDriveUrlMetadata(accessToken: string, itemReference: { itemId: string; resourceKey: string | null }): Promise<GoogleDriveItem | null> {
  const url = new URL(`${GOOGLE_API_BASE_URL}/files/${encodeURIComponent(itemReference.itemId)}`);
  url.searchParams.set("fields", "id,name,mimeType,size,modifiedTime,parents,driveId");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url, {
    headers: buildSourceBearerHeaders(accessToken, buildGoogleDriveResourceKeyHeader(itemReference))
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
    throw new Error(`Google Drive URL lookup failed: ${message}`);
  }

  return payload as GoogleDriveItem;
}

async function fetchGoogleDriveChildByName(input: {
  accessToken: string;
  parentId: string;
  name: string;
}): Promise<GoogleDriveItem | null> {
  const url = new URL(`${GOOGLE_API_BASE_URL}/files`);
  url.searchParams.set("pageSize", "1");
  url.searchParams.set(
    "q",
    `trashed = false and '${escapeGoogleQueryLiteral(input.parentId)}' in parents and name = '${escapeGoogleQueryLiteral(input.name)}'`
  );
  url.searchParams.set("fields", "files(id,name,mimeType,size,modifiedTime,parents,driveId)");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");

  const payload = await fetchJsonOrThrow<{ files?: GoogleDriveItem[] }>({
    url: url.toString(),
    headers: buildSourceBearerHeaders(input.accessToken),
    errorPrefix: "Google Drive path lookup failed"
  });
  return payload.files?.[0] ?? null;
}

async function buildGoogleDriveDisplayPath(input: {
  accessToken: string;
  item: GoogleDriveItem;
  folderCache: Map<string, Promise<GoogleDriveItem | null>>;
}): Promise<string | null> {
  const fetchFolder = (id: string): Promise<GoogleDriveItem | null> => {
    let promise = input.folderCache.get(id);
    if (!promise) {
      promise = fetchGoogleDriveMetadata(input.accessToken, id).catch(() => null);
      input.folderCache.set(id, promise);
    }
    return promise;
  };
  const segments: string[] = [];
  const visited = new Set<string>();
  let current: GoogleDriveItem | null = input.item;

  while (current && !visited.has(current.id) && segments.length < 100) {
    visited.add(current.id);
    segments.unshift(current.name);
    const parentId = current.parents?.[0];
    if (parentId === "root") {
      return ["My Drive", ...segments].join("/");
    }
    if (!parentId) {
      // Shared-drive roots use the drive ID; other parentless items need verification.
      if (current.driveId === current.id) {
        const cacheKey = `drive:${current.id}`;
        let drive = input.folderCache.get(cacheKey);
        if (!drive) {
          drive = fetchJsonOrThrow<GoogleDriveItem>({
            url: `${GOOGLE_API_BASE_URL}/drives/${encodeURIComponent(current.id)}?fields=id,name`,
            headers: buildSourceBearerHeaders(input.accessToken),
            errorPrefix: "Google Drive shared drive lookup failed"
          }).catch(() => null);
          input.folderCache.set(cacheKey, drive);
        }
        const metadata = await drive;
        if (!metadata) return null;
        segments[0] = metadata.name;
        return segments.join("/");
      }
      const root = await fetchFolder("root");
      if (root?.id === current.id) {
        segments[0] = "My Drive";
        return segments.join("/");
      }
      return null;
    }
    current = await fetchFolder(parentId);
  }

  // Missing or inaccessible parents do not establish a complete path.
  return null;
}

async function resolveGoogleDrivePath(input: {
  accessToken: string;
  path: string;
  folderId?: string | null;
}): Promise<SourceFileEntry | null> {
  const folderCache = new Map<string, Promise<GoogleDriveItem | null>>();
  const itemReference = extractGoogleDriveItemReferenceFromUrl(input.path.trim());
  if (itemReference) {
    const item = await fetchGoogleDriveUrlMetadata(input.accessToken, itemReference);
    return item
      ? normalizeGoogleDriveItem(
          item,
          encodeGoogleDriveItemReference(itemReference.itemId, itemReference.resourceKey),
          await buildGoogleDriveDisplayPath({ accessToken: input.accessToken, item, folderCache })
        )
      : null;
  }

  const segments = input.path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return null;
  }

  let parentId = input.folderId?.trim() || "root";
  let current: GoogleDriveItem | null = null;
  for (const segment of segments) {
    current = await fetchGoogleDriveChildByName({
      accessToken: input.accessToken,
      parentId,
      name: segment
    });
    if (!current) {
      return null;
    }
    folderCache.set(current.id, Promise.resolve(current));
    parentId = current.id;
  }

  return current
    ? normalizeGoogleDriveItem(current, undefined, await buildGoogleDriveDisplayPath({
        accessToken: input.accessToken, item: current, folderCache
      }))
    : null;
}

function resolveGoogleDriveDownload(input: GoogleDriveItem): { url: string; fileName: string; mimeType: string | null } {
  const exportConfig = getGoogleWorkspaceExport(input.mimeType);
  if (exportConfig) {
    const exportUrl = new URL(`${GOOGLE_API_BASE_URL}/files/${encodeURIComponent(input.id)}/export`);
    exportUrl.searchParams.set("mimeType", exportConfig.mimeType);
    const fileName = input.name.endsWith(exportConfig.extension)
      ? input.name
      : `${input.name}${exportConfig.extension}`;
    return {
      url: exportUrl.toString(),
      fileName,
      mimeType: exportConfig.mimeType
    };
  }

  if (isGoogleWorkspaceMimeType(input.mimeType)) {
    throw new Error(`Google Drive file type is not supported for export: ${input.mimeType}`);
  }

  const downloadUrl = new URL(`${GOOGLE_API_BASE_URL}/files/${encodeURIComponent(input.id)}`);
  downloadUrl.searchParams.set("alt", "media");
  downloadUrl.searchParams.set("supportsAllDrives", "true");
  return {
    url: downloadUrl.toString(),
    fileName: input.name,
    mimeType: input.mimeType ?? null
  };
}

export const googleDriveProviderClient: SourceProviderClient = {
  provider: "google-drive",
  buildAuthorizationUrl(input) {
    const url = new URL(GOOGLE_AUTHORIZE_URL);
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_DRIVE_SCOPE);
    url.searchParams.set("state", input.state);
    url.searchParams.set("code_challenge", input.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    return url.toString();
  },
  async exchangeCode(input): Promise<StoredSourceTokens> {
    const body = new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri
    });
    const payload = await fetchJsonOrThrow<Record<string, unknown>>({
      url: GOOGLE_TOKEN_URL,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      errorPrefix: "Google Drive OAuth exchange failed"
    });
    return buildStoredSourceTokens({ payload });
  },
  async refreshTokens(input): Promise<StoredSourceTokens> {
    const body = new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: "refresh_token",
      refresh_token: input.refreshToken
    });
    const payload = await fetchJsonOrThrow<Record<string, unknown>>({
      url: GOOGLE_TOKEN_URL,
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      errorPrefix: "Google Drive token refresh failed"
    });
    return buildStoredSourceTokens({ payload, fallbackRefreshToken: input.refreshToken });
  },
  async fetchAccountProfile(input): Promise<SourceAccountProfile> {
    const url = new URL(`${GOOGLE_API_BASE_URL}/about`);
    url.searchParams.set("fields", "user");
    const payload = await fetchJsonOrThrow<{ user?: { permissionId?: string; displayName?: string; emailAddress?: string } }>({
      url: url.toString(),
      headers: buildSourceBearerHeaders(input.accessToken),
      errorPrefix: "Google Drive account lookup failed"
    });
    return {
      accountId: payload.user?.permissionId ?? null,
      accountLabel: payload.user?.emailAddress ?? payload.user?.displayName ?? null
    };
  },
  async search(input): Promise<SourceSearchResult> {
    const trimmedQuery = input.query.trim();
    const folderClause = input.folderId
      ? `'${escapeGoogleQueryLiteral(input.folderId)}' in parents and `
      : "";
    const url = new URL(`${GOOGLE_API_BASE_URL}/files`);
    url.searchParams.set("pageSize", `${input.limit ?? 50}`);
    url.searchParams.set(
      "q",
      `trashed = false and ${folderClause}${buildGoogleDriveSearchTextQuery(trimmedQuery)}`
    );
    url.searchParams.set("fields", "files(id,name,mimeType,size,modifiedTime,parents,driveId)");
    url.searchParams.set("supportsAllDrives", "true");
    url.searchParams.set("includeItemsFromAllDrives", "true");
    url.searchParams.set("corpora", "allDrives");

    const payload = await fetchJsonOrThrow<{ files?: GoogleDriveItem[] }>({
      url: url.toString(),
      headers: buildSourceBearerHeaders(input.accessToken),
      errorPrefix: "Google Drive search failed"
    });

    const folderCache = new Map<string, Promise<GoogleDriveItem | null>>();
    const items = await Promise.all(
      (payload.files ?? []).map(async (item) => {
        const displayPath = await buildGoogleDriveDisplayPath({
          accessToken: input.accessToken,
          item,
          folderCache
        });
        return normalizeGoogleDriveItem(item, undefined, displayPath);
      })
    );

    return {
      items
    };
  },
  async resolvePath(input) {
    const item = await resolveGoogleDrivePath({
      accessToken: input.accessToken,
      path: input.path,
      folderId: input.folderId
    });
    return { items: item ? [item] : [] };
  },
  async browse(input): Promise<SourceBrowseResult> {
    const parentId = input.folderId ?? "root";
    const listUrl = new URL(`${GOOGLE_API_BASE_URL}/files`);
    listUrl.searchParams.set("pageSize", `${input.limit ?? 200}`);
    listUrl.searchParams.set("q", `trashed = false and '${escapeGoogleQueryLiteral(parentId)}' in parents`);
    listUrl.searchParams.set("fields", "files(id,name,mimeType,size,modifiedTime,parents,driveId)");
    listUrl.searchParams.set("orderBy", "folder,name_natural");
    listUrl.searchParams.set("supportsAllDrives", "true");
    listUrl.searchParams.set("includeItemsFromAllDrives", "true");

    const payload = await fetchJsonOrThrow<{ files?: GoogleDriveItem[] }>({
      url: listUrl.toString(),
      headers: buildSourceBearerHeaders(input.accessToken),
      errorPrefix: "Google Drive browse failed"
    });

    const folder = input.folderId && input.folderId !== "root"
      ? await fetchGoogleDriveMetadata(input.accessToken, input.folderId)
      : { id: null, name: "My Drive", parents: [] };
    const folderName = folder.name || "My Drive";

    return {
      folder: {
        id: input.folderId === "root" ? null : input.folderId,
        name: folderName,
        parentId: Array.isArray(folder.parents) && folder.parents.length > 0 && folder.parents[0] !== "root"
          ? folder.parents[0]
          : null
      },
      items: (payload.files ?? []).map((item) => normalizeGoogleDriveItem(item, undefined, `${folderName}/${item.name}`))
    };
  },
  async downloadFile(input): Promise<SourceDownloadResult> {
    const itemReference = decodeGoogleDriveItemReference(input.itemId);
    const metadata = await fetchGoogleDriveMetadata(input.accessToken, input.itemId);
    if (metadata.mimeType === "application/vnd.google-apps.folder") {
      throw new Error("Google Drive folders cannot be downloaded as task files.");
    }

    const resolvedDownload = resolveGoogleDriveDownload(metadata);
    const response = await fetch(resolvedDownload.url, {
      headers: buildSourceBearerHeaders(input.accessToken, buildGoogleDriveResourceKeyHeader(itemReference))
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(`Google Drive download failed: ${payload && typeof payload === "object" && "error" in payload ? String((payload as Record<string, unknown>).error) : `HTTP ${response.status}`}`);
    }

    return {
      fileName: resolvedDownload.fileName,
      mimeType: resolvedDownload.mimeType,
      sizeBytes: typeof metadata.size === "string" ? Number.parseInt(metadata.size, 10) : null,
      modifiedAt: metadata.modifiedTime ?? null,
      response
    };
  }
};
