import { getProjectContextNote } from "@meowbert/shared/project-context";
import { listDirectory } from "../files/directory-listing.js";
import { resolveProjectFileDirectory } from "../files/project-file-directory.js";
import { listSourceFileLinksForEnvironmentPaths } from "../source-file-links/store.js";
import type { SourceFileLinkSummary } from "../source-file-links/types.js";

function summarizeLiveSyncLink(link: SourceFileLinkSummary) {
  return {
    id: link.id,
    provider: link.provider,
    sourceId: link.sourceId,
    linkKind: link.linkKind,
    remoteName: link.remoteName,
    remoteWebUrl: link.remoteWebUrl,
    lastPulledAt: link.lastPulledAt,
    lastPushedAt: link.lastPushedAt,
    lastSyncError: link.lastSyncError
  };
}

// A project folder listing, with each entry's context note and live-sync link attached.
export async function listProjectDirectory(input: {
  environmentId: string;
  rootPath: string;
  jsonPayload: Record<string, unknown>;
  requestedPath?: string;
}) {
  const listing = await listDirectory(await resolveProjectFileDirectory(input.rootPath, input.requestedPath));
  const liveSyncLinks = await listSourceFileLinksForEnvironmentPaths(
    input.environmentId,
    listing.items.map((item) => item.relativePath)
  );
  const liveSyncByPath = new Map(
    liveSyncLinks.map((link) => [link.localRelativePath, summarizeLiveSyncLink(link)])
  );

  return {
    ...listing,
    items: listing.items.map((item) => ({
      ...item,
      note: getProjectContextNote(input.jsonPayload, item.relativePath),
      liveSync: liveSyncByPath.get(item.relativePath) ?? null
    }))
  };
}
