import path from "node:path";
import type { StoredSourceTokens } from "./source-types.js";

export const RCLONE_SOURCE_ACCESS_TOKEN = "rclone-config";

export interface RcloneSourceConfig {
  rcloneConfig: string;
  remoteName: string;
  baseDirectory: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRcloneConfigSectionNames(contents: string): Set<string> {
  const names = new Set<string>();
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }

    const match = trimmed.match(/^\[([^\]\r\n]+)\]$/);
    if (match) {
      names.add(match[1].trim());
    }
  }
  return names;
}

export function normalizeRcloneRemoteName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("rclone remote name is required.");
  }
  if (/[\r\n:[\]]/.test(trimmed)) {
    throw new Error("rclone remote name must be a single config section name without ':', '[' or ']'.");
  }
  return trimmed;
}

export function normalizeRcloneBaseDirectory(value: string | null | undefined): string {
  const trimmed = value?.trim().replace(/\\/g, "/") ?? "";
  if (!trimmed) {
    return "";
  }

  const withoutOuterSlashes = trimmed.replace(/^\/+|\/+$/g, "");
  const normalized = path.posix.normalize(withoutOuterSlashes);
  if (
    !normalized
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || path.posix.isAbsolute(normalized)
  ) {
    throw new Error("rclone base directory must stay within the configured remote.");
  }
  return normalized;
}

export function normalizeRcloneItemId(value: string | null | undefined): string {
  return normalizeRcloneBaseDirectory(value ?? "");
}

export function normalizeRcloneConfig(input: {
  rcloneConfig: string;
  remoteName: string;
  baseDirectory?: string | null;
}): RcloneSourceConfig {
  const rcloneConfig = input.rcloneConfig.trim();
  if (!rcloneConfig) {
    throw new Error("rclone.conf contents are required.");
  }

  const remoteName = normalizeRcloneRemoteName(input.remoteName);
  const sectionNames = readRcloneConfigSectionNames(rcloneConfig);
  if (!sectionNames.has(remoteName)) {
    throw new Error(`rclone.conf does not contain a [${remoteName}] section.`);
  }

  return {
    rcloneConfig,
    remoteName,
    baseDirectory: normalizeRcloneBaseDirectory(input.baseDirectory)
  };
}

export function buildRcloneAccountLabel(config: RcloneSourceConfig): string {
  return config.baseDirectory ? `${config.remoteName}:${config.baseDirectory}` : `${config.remoteName}:`;
}

export function buildRcloneStoredTokens(config: RcloneSourceConfig): StoredSourceTokens {
  return {
    accessToken: RCLONE_SOURCE_ACCESS_TOKEN,
    refreshToken: null,
    expiresAt: null,
    scope: "rclone",
    tokenType: null,
    raw: {
      rcloneConfig: config.rcloneConfig,
      remoteName: config.remoteName,
      baseDirectory: config.baseDirectory
    }
  };
}

export function parseRcloneSourceConfig(tokens?: StoredSourceTokens): RcloneSourceConfig {
  const raw = isPlainObject(tokens?.raw) ? tokens.raw : {};
  const rcloneConfig = typeof raw.rcloneConfig === "string" ? raw.rcloneConfig : "";
  const remoteName = typeof raw.remoteName === "string" ? raw.remoteName : "";
  const baseDirectory = typeof raw.baseDirectory === "string" ? raw.baseDirectory : "";
  return normalizeRcloneConfig({
    rcloneConfig,
    remoteName,
    baseDirectory
  });
}

export function buildRcloneRemotePath(config: RcloneSourceConfig, itemId?: string | null): string {
  const normalizedItemId = normalizeRcloneItemId(itemId);
  const pathParts = [config.baseDirectory, normalizedItemId].filter((part) => part.length > 0);
  const remotePath = pathParts.length > 0 ? path.posix.join(...pathParts) : "";
  return remotePath ? `${config.remoteName}:${remotePath}` : `${config.remoteName}:`;
}

export function buildRcloneChildItemId(parentItemId: string | null | undefined, name: string): string {
  const trimmedName = name.trim();
  if (!trimmedName || /[\\/\u0000-\u001f]/.test(trimmedName) || trimmedName === "." || trimmedName === "..") {
    throw new Error("rclone child item names must be single path segments.");
  }
  return normalizeRcloneItemId(path.posix.join(normalizeRcloneItemId(parentItemId), trimmedName));
}

export function getRcloneParentItemId(itemId: string): string | null {
  const normalized = normalizeRcloneItemId(itemId);
  if (!normalized) {
    return null;
  }

  const parent = path.posix.dirname(normalized);
  return parent === "." ? null : parent;
}
