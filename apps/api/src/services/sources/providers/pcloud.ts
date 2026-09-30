import { buildStoredSourceTokens, fetchJsonOrThrow } from "../provider-http.js";
import type {
  SourceAccountProfile,
  SourceBrowseResult,
  SourceDownloadResult,
  SourceFileEntry,
  SourceProviderClient,
  SourceSearchResult,
  StoredSourceTokens
} from "../source-types.js";

const PCLOUD_AUTHORIZE_URL = "https://my.pcloud.com/oauth2/authorize";
const PCLOUD_DEFAULT_API_HOST = "api.pcloud.com";
const PCLOUD_ALLOWED_API_HOSTS = new Set(["api.pcloud.com", "eapi.pcloud.com"]);
const PCLOUD_ROOT_FOLDER_ID = "d0";

interface PCloudMetadata {
  id?: string;
  fileid?: number | string;
  folderid?: number | string;
  parentfolderid?: number | string;
  name?: string;
  path?: string;
  isfolder?: boolean;
  contenttype?: string;
  size?: number | string;
  modified?: string;
  hash?: number | string;
  contents?: PCloudMetadata[];
}

interface PCloudEnvelope {
  result?: number;
  error?: string;
}

function normalizePCloudApiHost(value: unknown): string {
  const hostname = typeof value === "string" ? value.trim().toLowerCase() : "";
  return PCLOUD_ALLOWED_API_HOSTS.has(hostname) ? hostname : PCLOUD_DEFAULT_API_HOST;
}

function resolvePCloudApiHost(tokens?: StoredSourceTokens): string {
  return normalizePCloudApiHost(tokens?.raw.hostname ?? tokens?.raw.api_hostname);
}

function buildPCloudUrl(input: {
  tokens?: StoredSourceTokens;
  method: string;
  accessToken: string;
  params?: Record<string, string>;
}): URL {
  const url = new URL(`https://${resolvePCloudApiHost(input.tokens)}/${input.method}`);
  url.searchParams.set("access_token", input.accessToken);
  for (const [key, value] of Object.entries(input.params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url;
}

function assertPCloudSuccess<T extends PCloudEnvelope>(payload: T, prefix: string): T {
  if (payload.result !== undefined && payload.result !== 0) {
    throw new Error(`${prefix}: ${payload.error ?? `pCloud result ${payload.result}`}`);
  }
  return payload;
}

async function fetchPCloudJson<T extends PCloudEnvelope>(input: {
  accessToken: string;
  tokens?: StoredSourceTokens;
  method: string;
  params?: Record<string, string>;
  errorPrefix: string;
}): Promise<T> {
  const payload = await fetchJsonOrThrow<T>({
    url: buildPCloudUrl(input).toString(),
    errorPrefix: input.errorPrefix
  });
  return assertPCloudSuccess(payload, input.errorPrefix);
}

function parsePCloudDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
}

function parseNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function decodePCloudItemId(itemId: string): { kind: "file" | "folder"; numericId: string } {
  const trimmed = itemId.trim();
  const match = trimmed.match(/^([fd])(\d+)$/i);
  if (!match) {
    throw new Error("pCloud item IDs must use pCloud metadata IDs such as f123 or d456.");
  }
  return {
    kind: match[1].toLowerCase() === "d" ? "folder" : "file",
    numericId: match[2]
  };
}

function normalizePCloudLookupPath(value: string, folderPath?: string | null): string {
  const itemPath = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  const parentPath = folderPath
    ?.trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "") ?? "";
  const combined = [parentPath, itemPath]
    .filter((part) => part.length > 0)
    .join("/");
  return `/${combined}`;
}

function normalizePCloudItem(item: PCloudMetadata): SourceFileEntry {
  const kind = item.isfolder ? "folder" : "file";
  const numericId = kind === "folder" ? item.folderid : item.fileid;
  const id = typeof item.id === "string" && item.id.length > 0
    ? item.id
    : `${kind === "folder" ? "d" : "f"}${String(numericId ?? "")}`;
  return {
    id,
    name: item.name ?? (kind === "folder" ? "Untitled folder" : "Untitled file"),
    displayPath: item.path ?? null,
    kind,
    mimeType: kind === "file" ? item.contenttype ?? null : null,
    sizeBytes: kind === "file" ? parseNullableNumber(item.size) : null,
    modifiedAt: parsePCloudDate(item.modified),
    parentId: item.parentfolderid === undefined ? null : `d${String(item.parentfolderid)}`
  };
}

async function fetchPCloudMetadata(input: {
  accessToken: string;
  tokens?: StoredSourceTokens;
  itemId: string;
}): Promise<PCloudMetadata> {
  const item = decodePCloudItemId(input.itemId);
  if (item.kind === "folder") {
    const payload = await fetchPCloudJson<PCloudEnvelope & { metadata?: PCloudMetadata }>({
      accessToken: input.accessToken,
      tokens: input.tokens,
      method: "listfolder",
      params: { folderid: item.numericId },
      errorPrefix: "pCloud folder metadata request failed"
    });
    if (!payload.metadata) {
      throw new Error("pCloud folder metadata response was invalid.");
    }
    return payload.metadata;
  }

  const payload = await fetchPCloudJson<PCloudEnvelope & { metadata?: PCloudMetadata }>({
    accessToken: input.accessToken,
    tokens: input.tokens,
    method: "stat",
    params: { fileid: item.numericId },
    errorPrefix: "pCloud file metadata request failed"
  });
  if (!payload.metadata) {
    throw new Error("pCloud file metadata response was invalid.");
  }
  return payload.metadata;
}

async function fetchPCloudMetadataByPath(input: {
  accessToken: string;
  tokens?: StoredSourceTokens;
  path: string;
  folderId?: string | null;
}): Promise<PCloudMetadata | null> {
  let folderPath: string | null = null;
  if (input.folderId) {
    const folder = await fetchPCloudMetadata({
      accessToken: input.accessToken,
      tokens: input.tokens,
      itemId: input.folderId
    });
    if (!folder.isfolder) {
      throw new Error("pCloud path lookup folder ID must be a folder.");
    }
    folderPath = folder.path ?? null;
  }

  const lookupPath = normalizePCloudLookupPath(input.path, folderPath);
  const payload = await fetchJsonOrThrow<PCloudEnvelope & { metadata?: PCloudMetadata }>({
    url: buildPCloudUrl({
      accessToken: input.accessToken,
      tokens: input.tokens,
      method: "stat",
      params: { path: lookupPath }
    }).toString(),
    errorPrefix: "pCloud path lookup failed"
  });
  if (payload.result === 2005 || payload.result === 2009) {
    return null;
  }
  assertPCloudSuccess(payload, "pCloud path lookup failed");
  if (!payload.metadata) {
    throw new Error("pCloud path lookup response was invalid.");
  }
  return payload.metadata;
}

function appendPCloudMatches(input: {
  query: string;
  limit: number;
  folder: PCloudMetadata;
  items: SourceFileEntry[];
}): void {
  for (const item of input.folder.contents ?? []) {
    if (input.items.length >= input.limit) {
      return;
    }

    const searchable = `${item.name ?? ""}\n${item.path ?? ""}`.toLowerCase();
    if (searchable.includes(input.query)) {
      input.items.push(normalizePCloudItem(item));
    }

    if (item.isfolder && Array.isArray(item.contents)) {
      appendPCloudMatches({
        ...input,
        folder: item
      });
    }
  }
}

export const pcloudProviderClient: SourceProviderClient = {
  provider: "pcloud",
  buildAuthorizationUrl(input) {
    const url = new URL(PCLOUD_AUTHORIZE_URL);
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", input.state);
    return url.toString();
  },
  async exchangeCode(input): Promise<StoredSourceTokens> {
    const host = normalizePCloudApiHost(input.callbackQuery?.hostname);
    const url = new URL(`https://${host}/oauth2_token`);
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("client_secret", input.clientSecret);
    url.searchParams.set("code", input.code);
    const payload = await fetchJsonOrThrow<Record<string, unknown>>({
      url: url.toString(),
      errorPrefix: "pCloud OAuth exchange failed"
    });
    const tokens = buildStoredSourceTokens({
      payload: {
        ...payload,
        hostname: host,
        locationid: input.callbackQuery?.locationid ?? payload.locationid
      }
    });
    return tokens;
  },
  async refreshTokens(): Promise<StoredSourceTokens> {
    throw new Error("pCloud OAuth tokens cannot be refreshed; reconnect the workspace pCloud source.");
  },
  async fetchAccountProfile(input): Promise<SourceAccountProfile> {
    const payload = await fetchPCloudJson<PCloudEnvelope & { userid?: number | string; email?: string; emailverified?: boolean }>({
      accessToken: input.accessToken,
      tokens: input.tokens,
      method: "userinfo",
      errorPrefix: "pCloud account lookup failed"
    });
    return {
      accountId: payload.userid === undefined ? null : String(payload.userid),
      accountLabel: payload.email ?? null
    };
  },
  async search(input): Promise<SourceSearchResult> {
    const query = input.query.trim().toLowerCase();
    const folderReference = input.folderId ? decodePCloudItemId(input.folderId) : { kind: "folder" as const, numericId: "0" };
    if (folderReference.kind !== "folder") {
      throw new Error("pCloud search folder ID must be a folder.");
    }

    const payload = await fetchPCloudJson<PCloudEnvelope & { metadata?: PCloudMetadata }>({
      accessToken: input.accessToken,
      tokens: input.tokens,
      method: "listfolder",
      params: {
        folderid: folderReference.numericId,
        recursive: "1"
      },
      errorPrefix: "pCloud search failed"
    });
    if (!payload.metadata) {
      throw new Error("pCloud search response was invalid.");
    }

    const items: SourceFileEntry[] = [];
    appendPCloudMatches({
      query,
      limit: input.limit ?? 50,
      folder: payload.metadata,
      items
    });
    return { items };
  },
  async resolvePath(input) {
    const item = await fetchPCloudMetadataByPath({
      accessToken: input.accessToken,
      tokens: input.tokens,
      path: input.path,
      folderId: input.folderId
    });
    return {
      items: item ? [normalizePCloudItem(item)] : []
    };
  },
  async browse(input): Promise<SourceBrowseResult> {
    const folderReference = input.folderId ? decodePCloudItemId(input.folderId) : { kind: "folder" as const, numericId: "0" };
    if (folderReference.kind !== "folder") {
      throw new Error("pCloud browse folder ID must be a folder.");
    }

    const payload = await fetchPCloudJson<PCloudEnvelope & { metadata?: PCloudMetadata }>({
      accessToken: input.accessToken,
      tokens: input.tokens,
      method: "listfolder",
      params: { folderid: folderReference.numericId },
      errorPrefix: "pCloud browse failed"
    });
    const folder = payload.metadata;
    if (!folder) {
      throw new Error("pCloud browse response was invalid.");
    }
    const limit = input.limit ?? 200;
    return {
      folder: {
        id: input.folderId ?? PCLOUD_ROOT_FOLDER_ID,
        name: folder.name ?? "pCloud",
        parentId: folder.parentfolderid === undefined ? null : `d${String(folder.parentfolderid)}`
      },
      items: (folder.contents ?? []).slice(0, limit).map(normalizePCloudItem)
    };
  },
  async downloadFile(input): Promise<SourceDownloadResult> {
    const metadata = await fetchPCloudMetadata({
      accessToken: input.accessToken,
      tokens: input.tokens,
      itemId: input.itemId
    });
    if (metadata.isfolder) {
      throw new Error("pCloud folders cannot be downloaded as task files.");
    }
    const item = decodePCloudItemId(input.itemId);
    const payload = await fetchPCloudJson<PCloudEnvelope & { hosts?: string[]; path?: string }>({
      accessToken: input.accessToken,
      tokens: input.tokens,
      method: "getfilelink",
      params: {
        fileid: item.numericId,
        forcedownload: "1"
      },
      errorPrefix: "pCloud download link request failed"
    });
    const host = payload.hosts?.[0];
    if (!host || !payload.path) {
      throw new Error("pCloud download link response was invalid.");
    }

    const response = await fetch(`https://${host}${payload.path}`);
    if (!response.ok) {
      throw new Error(`pCloud download failed: HTTP ${response.status}`);
    }

    return {
      fileName: metadata.name ?? "download.bin",
      mimeType: metadata.contenttype ?? null,
      sizeBytes: parseNullableNumber(metadata.size),
      modifiedAt: parsePCloudDate(metadata.modified),
      response
    };
  }
};
