import path from "node:path";
import {
  buildRcloneAccountLabel,
  buildRcloneRemotePath,
  buildRcloneStoredTokens,
  getRcloneParentItemId,
  normalizeRcloneConfig,
  normalizeRcloneItemId,
  parseRcloneSourceConfig,
  RCLONE_SOURCE_ACCESS_TOKEN
} from "../rclone-config.js";
import {
  createRcloneCatResponse,
  rcloneLsjson,
  type RcloneListJsonItem
} from "../rclone-cli.js";
import { upsertWorkspaceSourceConnection } from "../workspace-source-connections.js";
import type {
  SourceAccountProfile,
  SourceBrowseResult,
  SourceDownloadResult,
  SourceFileEntry,
  SourceProviderClient,
  SourceSearchResult,
  StoredSourceTokens
} from "../source-types.js";

function parseRcloneDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : value;
}

function getRcloneItemRelativePath(item: RcloneListJsonItem, parentFolderId?: string | null): string {
  const itemPath = normalizeRcloneItemId(item.Path ?? item.Name ?? "");
  const parentPath = normalizeRcloneItemId(parentFolderId ?? "");
  return parentPath && itemPath ? normalizeRcloneItemId(path.posix.join(parentPath, itemPath)) : itemPath;
}

function getRcloneItemName(item: RcloneListJsonItem, parentFolderId?: string | null): string {
  const name = item.Name?.trim();
  if (name) {
    return name;
  }

  const itemPath = getRcloneItemRelativePath(item, parentFolderId);
  return itemPath ? path.posix.basename(itemPath) : "rclone";
}

function normalizeRcloneItem(item: RcloneListJsonItem, parentFolderId?: string | null): SourceFileEntry {
  const itemPath = getRcloneItemRelativePath(item, parentFolderId);
  const kind = item.IsDir ? "folder" : "file";
  return {
    id: itemPath,
    name: getRcloneItemName(item, parentFolderId),
    displayPath: itemPath || null,
    kind,
    mimeType: kind === "file" ? item.MimeType ?? null : null,
    sizeBytes: kind === "file" && typeof item.Size === "number" && Number.isFinite(item.Size) ? item.Size : null,
    modifiedAt: parseRcloneDate(item.ModTime),
    parentId: getRcloneParentItemId(itemPath)
  };
}

function normalizeRcloneStatItem(item: RcloneListJsonItem, itemId: string): SourceFileEntry {
  return normalizeRcloneItem({ ...item, Path: itemId }, null);
}

function getFolderName(folderId: string | null, tokens?: StoredSourceTokens): string {
  if (folderId) {
    return path.posix.basename(folderId);
  }

  const config = parseRcloneSourceConfig(tokens);
  return config.baseDirectory ? path.posix.basename(config.baseDirectory) : `${config.remoteName}:`;
}

async function listRcloneFolder(input: {
  tokens?: StoredSourceTokens;
  folderId: string | null;
}): Promise<RcloneListJsonItem[]> {
  const config = parseRcloneSourceConfig(input.tokens);
  const remotePath = buildRcloneRemotePath(config, input.folderId);
  const items = await rcloneLsjson({
    sourceConfig: config,
    remotePath
  });
  return Array.isArray(items) ? items : [];
}

async function findRcloneExactPath(input: {
  config: ReturnType<typeof parseRcloneSourceConfig>;
  query: string;
  folderId: string | null;
}): Promise<SourceFileEntry | null> {
  const queryPath = normalizeRcloneItemId(input.query);
  if (!queryPath) {
    return null;
  }

  const itemId = normalizeRcloneItemId(path.posix.join(input.folderId ?? "", queryPath));
  const remotePath = buildRcloneRemotePath(input.config, itemId);
  try {
    const payload = await rcloneLsjson({
      sourceConfig: input.config,
      remotePath,
      stat: true
    });
    if (!Array.isArray(payload)) {
      return normalizeRcloneStatItem(payload, itemId);
    }
  } catch {
    return null;
  }

  return null;
}

export async function connectWorkspaceRcloneSource(input: {
  workspaceId: string;
  userId: string;
  rcloneConfig: string;
  remoteName: string;
  baseDirectory?: string | null;
}): Promise<{ accountLabel: string }> {
  const sourceConfig = normalizeRcloneConfig(input);
  const tokens = buildRcloneStoredTokens(sourceConfig);

  await rcloneProviderClient.browse({
    accessToken: RCLONE_SOURCE_ACCESS_TOKEN,
    tokens,
    folderId: null,
    limit: 1
  });

  const accountLabel = buildRcloneAccountLabel(sourceConfig);
  await upsertWorkspaceSourceConnection({
    workspaceId: input.workspaceId,
    provider: "rclone",
    tokens,
    accountId: sourceConfig.remoteName,
    accountLabel,
    updatedByUserId: input.userId
  });

  return { accountLabel };
}

export const rcloneProviderClient: SourceProviderClient = {
  provider: "rclone",
  buildAuthorizationUrl() {
    throw new Error("rclone sources are configured directly in workspace source settings.");
  },
  async exchangeCode(): Promise<StoredSourceTokens> {
    throw new Error("rclone sources do not use OAuth.");
  },
  async refreshTokens(): Promise<StoredSourceTokens> {
    throw new Error("rclone source connections do not use refresh tokens.");
  },
  async fetchAccountProfile(input): Promise<SourceAccountProfile> {
    const sourceConfig = parseRcloneSourceConfig(input.tokens);
    return {
      accountId: sourceConfig.remoteName,
      accountLabel: buildRcloneAccountLabel(sourceConfig)
    };
  },
  async search(input): Promise<SourceSearchResult> {
    const query = input.query.trim().toLowerCase();
    const config = parseRcloneSourceConfig(input.tokens);
    const remotePath = buildRcloneRemotePath(config, input.folderId);
    const payload = await rcloneLsjson({
      sourceConfig: config,
      remotePath,
      recursive: true
    });
    const items = (Array.isArray(payload) ? payload : [])
      .map((item) => normalizeRcloneItem(item))
      .filter((item) => `${item.name}\n${item.displayPath ?? ""}`.toLowerCase().includes(query))
      .slice(0, input.limit ?? 50);

    return { items };
  },
  async resolvePath(input) {
    const config = parseRcloneSourceConfig(input.tokens);
    const item = await findRcloneExactPath({
      config,
      query: input.path,
      folderId: input.folderId ? normalizeRcloneItemId(input.folderId) : null
    });
    return {
      items: item ? [item] : []
    };
  },
  async browse(input): Promise<SourceBrowseResult> {
    const folderId = input.folderId ? normalizeRcloneItemId(input.folderId) : null;
    const items = (await listRcloneFolder({
      tokens: input.tokens,
      folderId
    })).slice(0, input.limit ?? 200);

    return {
      folder: {
        id: folderId,
        name: getFolderName(folderId, input.tokens),
        parentId: folderId ? getRcloneParentItemId(folderId) : null
      },
      items: items.map((item) => normalizeRcloneItem(item, folderId))
    };
  },
  async downloadFile(input): Promise<SourceDownloadResult> {
    const config = parseRcloneSourceConfig(input.tokens);
    const itemId = normalizeRcloneItemId(input.itemId);
    const remotePath = buildRcloneRemotePath(config, itemId);
    const metadata = await rcloneLsjson({
      sourceConfig: config,
      remotePath,
      stat: true
    }) as RcloneListJsonItem;
    if (metadata.IsDir) {
      throw new Error("rclone folders cannot be downloaded as task files.");
    }

    return {
      fileName: getRcloneItemName({ ...metadata, Path: itemId }),
      mimeType: metadata.MimeType ?? null,
      sizeBytes: typeof metadata.Size === "number" && Number.isFinite(metadata.Size) ? metadata.Size : null,
      modifiedAt: parseRcloneDate(metadata.ModTime),
      response: await createRcloneCatResponse({
        sourceConfig: config,
        remotePath
      })
    };
  }
};
