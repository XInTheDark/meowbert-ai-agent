import {
  isSourceManifest,
  isSourceProviderRuntimeEnabled,
  loadSkillManifestEntries,
  type SkillManifest
} from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { isSourceProvider, type SourceAttachmentMode, type SourceProvider } from "./source-types.js";

export interface SourceCatalogEntry {
  manifest: SkillManifest;
  skillDir: string;
  provider: SourceProvider;
  supportsAttachments: boolean;
  supportsLiveSync: boolean;
  attachmentMode: SourceAttachmentMode;
  requiresAdminCredentials: boolean;
  requiresWorkspaceConnection: boolean;
}

function toSourceCatalogEntry(input: { manifest: SkillManifest; skillDir: string }): SourceCatalogEntry | null {
  if (!isSourceManifest(input.manifest)) {
    return null;
  }

  const provider = input.manifest.source?.provider;
  if (!provider || !isSourceProvider(provider) || !isSourceProviderRuntimeEnabled(provider)) {
    return null;
  }

  return {
    manifest: input.manifest,
    skillDir: input.skillDir,
    provider,
    supportsAttachments: input.manifest.source?.supportsAttachments !== false,
    supportsLiveSync: (
      provider === "onedrive"
      || provider === "google-drive"
      || provider === "pcloud"
      || provider === "rclone"
    ) && (input.manifest.source?.attachmentMode ?? "file") === "file",
    attachmentMode: input.manifest.source?.attachmentMode ?? "file",
    requiresAdminCredentials: input.manifest.source?.requiresAdminCredentials !== false,
    requiresWorkspaceConnection: input.manifest.source?.requiresWorkspaceConnection !== false
  };
}

export function listSourceCatalogEntries(): SourceCatalogEntry[] {
  const rootDir = config.skills?.rootDir;
  if (!rootDir) {
    return [];
  }

  return Array.from(loadSkillManifestEntries(rootDir).values())
    .map((entry) => toSourceCatalogEntry(entry))
    .filter((entry): entry is SourceCatalogEntry => entry !== null)
    .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name));
}

export function getSourceCatalogEntry(sourceId: string): SourceCatalogEntry | null {
  const rootDir = config.skills?.rootDir;
  if (!rootDir) {
    return null;
  }

  const entry = loadSkillManifestEntries(rootDir).get(sourceId);
  if (!entry) {
    return null;
  }

  return toSourceCatalogEntry(entry);
}
