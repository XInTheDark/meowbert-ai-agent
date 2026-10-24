import fs from "node:fs";
import path from "node:path";
import {
  getSkillCatalogGroup,
  isVisibleSkillManifest,
  loadSkillManifestEntries,
  type SkillManifestEntry,
  type SkillManifest,
  type SkillCatalogGroup
} from "@meowbert/shared";

export type SkillEntry = SkillManifestEntry;

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  catalogGroup?: SkillCatalogGroup;
}

interface SkillRegistryOptions {
  isSkillEnabled?: (manifest: SkillManifest) => boolean;
}

function isSkillVisible(
  manifest: SkillManifest,
  actorIsSuperAdmin: boolean,
  options?: SkillRegistryOptions
): boolean {
  if (!isVisibleSkillManifest(manifest)) {
    return false;
  }
  if (options?.isSkillEnabled && !options.isSkillEnabled(manifest)) {
    return false;
  }
  return actorIsSuperAdmin || manifest.requiresSuperAdmin !== true;
}

export function loadSkillManifests(rootDir: string): Map<string, SkillEntry> {
  return loadSkillManifestEntries(rootDir);
}

export function getAvailableSkills(
  rootDir: string,
  actorIsSuperAdmin: boolean,
  options?: SkillRegistryOptions
): SkillSummary[] {
  const skills = loadSkillManifests(rootDir);
  return Array.from(skills.values())
    .filter((entry) => isSkillVisible(entry.manifest, actorIsSuperAdmin, options))
    .map((entry) => ({
      id: entry.manifest.id,
      name: entry.manifest.name,
      description: entry.manifest.description,
      catalogGroup: getSkillCatalogGroup(entry.manifest)
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getSkillEntry(rootDir: string, skillId: string): SkillEntry | null {
  const skills = loadSkillManifests(rootDir);
  return skills.get(skillId) ?? null;
}

export function getSkillDoc(skillDir: string): string | null {
  const docPath = path.join(skillDir, "skill.md");
  if (!fs.existsSync(docPath)) {
    return null;
  }
  return fs.readFileSync(docPath, "utf-8");
}
