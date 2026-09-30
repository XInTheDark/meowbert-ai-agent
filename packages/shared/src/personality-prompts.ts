import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_ENVIRONMENT_PERSONALITY_ID = "default";
export const NONE_ENVIRONMENT_PERSONALITY_ID = "none";
export const NEURAL_ENVIRONMENT_PERSONALITY_ID = "neural";

export interface PersonalityPromptEntry {
  id: string;
  promptText: string;
}

export interface PersonalityPromptCatalog {
  entries: PersonalityPromptEntry[];
  byId: ReadonlyMap<string, PersonalityPromptEntry>;
}

let cachedCatalog: PersonalityPromptCatalog | null = null;

function normalizePersonalityId(rawId: string): string | null {
  const normalized = rawId.trim().toLowerCase();
  if (normalized.length === 0) {
    return null;
  }

  return normalized;
}

function normalizeRequestedPersonalityId(rawId: unknown): string | null {
  if (typeof rawId !== "string") {
    return null;
  }

  return normalizePersonalityId(rawId);
}

function isPromptFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();
  if (!lowerName.endsWith(".md")) {
    return false;
  }

  return lowerName !== "readme.md";
}

function personalityLabelFromId(id: string): string {
  return id
    .split(/[-_\s]+/g)
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatPersonalityLabel(id: string): string {
  return personalityLabelFromId(id);
}

export function resolvePersonalityPromptDirectory(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  return path.resolve(currentDir, "../../../prompt-texts/personality");
}

export function loadPersonalityBasePrompt(): string {
  const promptPath = path.resolve(resolvePersonalityPromptDirectory(), "../BASE.md");

  try {
    return fs.readFileSync(promptPath, "utf-8").trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to read personality base prompt file ${promptPath}: ${message}`);
    return "";
  }
}

export function loadPersonalityPromptCatalog(input?: {
  forceReload?: boolean;
  directoryPath?: string;
}): PersonalityPromptCatalog {
  const directoryPath = input?.directoryPath ?? resolvePersonalityPromptDirectory();
  const canUseCache = !input?.forceReload && !input?.directoryPath;
  if (canUseCache && cachedCatalog) {
    return cachedCatalog;
  }

  const entries: PersonalityPromptEntry[] = [];
  let directoryEntries: fs.Dirent[] = [];
  try {
    directoryEntries = fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to read personality prompt directory ${directoryPath}: ${message}`);
    const emptyCatalog: PersonalityPromptCatalog = { entries: [], byId: new Map() };
    if (canUseCache) {
      cachedCatalog = emptyCatalog;
    }
    return emptyCatalog;
  }

  for (const directoryEntry of directoryEntries) {
    if (!directoryEntry.isFile() || !isPromptFile(directoryEntry.name)) {
      continue;
    }

    const parsedName = path.parse(directoryEntry.name);
    const normalizedId = normalizePersonalityId(parsedName.name);
    if (!normalizedId) {
      continue;
    }

    const promptPath = path.join(directoryPath, directoryEntry.name);
    try {
      const promptText = fs.readFileSync(promptPath, "utf-8").trim();
      entries.push({
        id: normalizedId,
        promptText
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to read personality prompt file ${promptPath}: ${message}`);
    }
  }

  entries.sort((left, right) => left.id.localeCompare(right.id));
  const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
  const catalog: PersonalityPromptCatalog = {
    entries,
    byId
  };

  if (canUseCache) {
    cachedCatalog = catalog;
  }

  return catalog;
}

export function loadNeuralPersonalityPrompt(): string {
  return loadPersonalityPromptCatalog().byId.get(NEURAL_ENVIRONMENT_PERSONALITY_ID)?.promptText?.trim() ?? "";
}

export function resolveEnvironmentPersonalityId(input: {
  requestedId: unknown;
  catalog: PersonalityPromptCatalog;
  defaultId?: string | null;
}): string | null {
  if (input.catalog.entries.length === 0) {
    return null;
  }

  const requestedId = normalizeRequestedPersonalityId(input.requestedId);
  if (requestedId && input.catalog.byId.has(requestedId)) {
    return requestedId;
  }

  const providedDefaultId = normalizeRequestedPersonalityId(input.defaultId ?? null);
  if (providedDefaultId && input.catalog.byId.has(providedDefaultId)) {
    return providedDefaultId;
  }

  if (input.catalog.byId.has(DEFAULT_ENVIRONMENT_PERSONALITY_ID)) {
    return DEFAULT_ENVIRONMENT_PERSONALITY_ID;
  }

  if (input.catalog.byId.has(NONE_ENVIRONMENT_PERSONALITY_ID)) {
    return NONE_ENVIRONMENT_PERSONALITY_ID;
  }

  return input.catalog.entries[0]?.id ?? null;
}

export function listPersonalityOptions(catalog: PersonalityPromptCatalog): Array<{
  id: string;
  label: string;
}> {
  return catalog.entries.map((entry) => ({
    id: entry.id,
    label: formatPersonalityLabel(entry.id)
  }));
}
