import { getSourceFileProviderClient } from "./provider-clients.js";
import { getSourceCatalogEntry, listSourceCatalogEntries } from "./source-catalog.js";
import { resolveWorkspaceSourceAccess } from "./source-access.js";
import type { SourceBrowseResult, SourceDownloadResult, SourcePathLookupResult, SourceSearchResult } from "./source-types.js";

export function listAvailableWorkspaceSources() {
  return listSourceCatalogEntries();
}

function requireSourceCatalogEntry(sourceId: string) {
  const entry = getSourceCatalogEntry(sourceId);
  if (!entry) {
    throw new Error(`Source not found: ${sourceId}`);
  }
  return entry;
}

export async function searchWorkspaceSource(input: {
  workspaceId: string;
  sourceId: string;
  query: string;
  folderId?: string | null;
  limit?: number;
}): Promise<SourceSearchResult> {
  const sourceEntry = requireSourceCatalogEntry(input.sourceId);
  const access = await resolveWorkspaceSourceAccess({
    workspaceId: input.workspaceId,
    provider: sourceEntry.provider,
    requiresAdminCredentials: sourceEntry.requiresAdminCredentials
  });
  const client = getSourceFileProviderClient(sourceEntry.provider);
  return client.search({
    accessToken: access.accessToken,
    tokens: access.connection.tokens,
    query: input.query,
    folderId: input.folderId ?? null,
    limit: input.limit
  });
}

export async function browseWorkspaceSource(input: {
  workspaceId: string;
  sourceId: string;
  folderId: string | null;
  limit?: number;
}): Promise<SourceBrowseResult> {
  const sourceEntry = requireSourceCatalogEntry(input.sourceId);
  const access = await resolveWorkspaceSourceAccess({
    workspaceId: input.workspaceId,
    provider: sourceEntry.provider,
    requiresAdminCredentials: sourceEntry.requiresAdminCredentials
  });
  const client = getSourceFileProviderClient(sourceEntry.provider);
  return client.browse({
    accessToken: access.accessToken,
    tokens: access.connection.tokens,
    folderId: input.folderId,
    limit: input.limit
  });
}

export async function resolveWorkspaceSourcePath(input: {
  workspaceId: string;
  sourceId: string;
  path: string;
  folderId?: string | null;
}): Promise<SourcePathLookupResult> {
  const sourceEntry = requireSourceCatalogEntry(input.sourceId);
  const access = await resolveWorkspaceSourceAccess({
    workspaceId: input.workspaceId,
    provider: sourceEntry.provider,
    requiresAdminCredentials: sourceEntry.requiresAdminCredentials
  });
  const client = getSourceFileProviderClient(sourceEntry.provider);
  return client.resolvePath({
    accessToken: access.accessToken,
    tokens: access.connection.tokens,
    path: input.path,
    folderId: input.folderId ?? null
  });
}

export async function downloadWorkspaceSourceFile(input: {
  workspaceId: string;
  sourceId: string;
  itemId: string;
}): Promise<SourceDownloadResult> {
  const sourceEntry = requireSourceCatalogEntry(input.sourceId);
  const access = await resolveWorkspaceSourceAccess({
    workspaceId: input.workspaceId,
    provider: sourceEntry.provider,
    requiresAdminCredentials: sourceEntry.requiresAdminCredentials
  });
  const client = getSourceFileProviderClient(sourceEntry.provider);
  return client.downloadFile({
    accessToken: access.accessToken,
    tokens: access.connection.tokens,
    itemId: input.itemId
  });
}
