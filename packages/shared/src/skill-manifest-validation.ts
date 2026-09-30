import { isBrowserUseEnabled, isHtmlCanvasEnabled, isOfficeEnabled, type AppConfig } from "./config.js";
import { loadSkillManifestEntries } from "./skill-manifests.js";

type SkillConfig = Pick<AppConfig, "skills">;

function getExplicitlyEnabledBundledSkillIds(config: SkillConfig): string[] {
  const skills = config.skills;
  if (!skills?.rootDir) {
    return [];
  }

  const enabledSkillIds: string[] = [];

  if (skills.browserUse?.enabled === true && isBrowserUseEnabled(config)) {
    enabledSkillIds.push("browser-use");
  }

  if (skills.htmlCanvas?.enabled === true && isHtmlCanvasEnabled(config)) {
    enabledSkillIds.push("html-canvas");
  }

  if (skills.office?.enabled === true && isOfficeEnabled(config)) {
    enabledSkillIds.push("docx-studio", "pptx-studio");
  }

  return enabledSkillIds;
}

export function getMissingEnabledBundledSkillManifestIds(config: SkillConfig): string[] {
  const rootDir = config.skills?.rootDir;
  if (!rootDir) {
    return [];
  }

  const expectedSkillIds = getExplicitlyEnabledBundledSkillIds(config);
  if (expectedSkillIds.length === 0) {
    return [];
  }

  const manifests = loadSkillManifestEntries(rootDir);
  return expectedSkillIds.filter((skillId) => !manifests.has(skillId));
}

export function assertEnabledBundledSkillManifestsPresent(config: SkillConfig): void {
  const rootDir = config.skills?.rootDir;
  if (!rootDir) {
    return;
  }

  const missingSkillIds = getMissingEnabledBundledSkillManifestIds(config);
  if (missingSkillIds.length === 0) {
    return;
  }

  throw new Error(
    `Enabled Meowbert skill manifests missing from ${rootDir}: ${missingSkillIds.join(", ")}. `
    + "Rebuild or redeploy the API/worker images so /app/skills includes those manifests."
  );
}
