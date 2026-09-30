const DEFAULT_DESKTOP_RELEASE_REPOSITORY = "XInTheDark/meowbert-ai-agent";
const DESKTOP_RELEASES_REPOSITORY = resolveDesktopReleaseRepository(import.meta.env.VITE_DESKTOP_RELEASE_REPOSITORY);
const DESKTOP_RELEASES_BASE_URL = `https://github.com/${DESKTOP_RELEASES_REPOSITORY}/releases`;
const DESKTOP_RELEASES_PAGE_URL = resolveDesktopReleasesPageUrl(import.meta.env.VITE_DESKTOP_RELEASES_PAGE_URL, DESKTOP_RELEASES_BASE_URL);
const DESKTOP_LATEST_RELEASE_PAGE_URL = `${DESKTOP_RELEASES_BASE_URL}/latest`;
const DESKTOP_LATEST_RELEASE_DOWNLOAD_URL = `${DESKTOP_LATEST_RELEASE_PAGE_URL}/download`;

export const LATEST_DESKTOP_MAC_ASSET_NAME = "Meowbert-desktop-mac-universal.dmg";
export const LATEST_DESKTOP_WINDOWS_ASSET_NAME = "Meowbert-desktop-win-x64.exe";

export interface DesktopDownloadLinks {
  releaseUrl: string;
  macUrl: string;
  windowsUrl: string;
  version: string | null;
  publishedAt: string | null;
}

function resolveDesktopReleaseRepository(value: string | undefined): string {
  const candidate = value?.trim();
  if (candidate && /^[^/\s]+\/[^/\s]+$/.test(candidate)) {
    return candidate;
  }
  return DEFAULT_DESKTOP_RELEASE_REPOSITORY;
}

function resolveDesktopReleasesPageUrl(value: string | undefined, fallbackUrl: string): string {
  const candidate = value?.trim();
  if (!candidate) {
    return fallbackUrl;
  }

  try {
    return new URL(candidate).toString();
  } catch {
    return fallbackUrl;
  }
}

function latestReleaseDownloadUrl(assetName: string): string {
  return `${DESKTOP_LATEST_RELEASE_DOWNLOAD_URL}/${encodeURIComponent(assetName)}`;
}

export function desktopReleasesPageUrl(): string {
  return DESKTOP_RELEASES_PAGE_URL;
}

export function fallbackDesktopDownloadLinks(): DesktopDownloadLinks {
  return {
    releaseUrl: DESKTOP_LATEST_RELEASE_PAGE_URL,
    macUrl: latestReleaseDownloadUrl(LATEST_DESKTOP_MAC_ASSET_NAME),
    windowsUrl: latestReleaseDownloadUrl(LATEST_DESKTOP_WINDOWS_ASSET_NAME),
    version: null,
    publishedAt: null
  };
}

export function detectPreferredDesktopPlatform(userAgent: string | undefined): "mac" | "windows" | "other" {
  const value = userAgent?.toLowerCase() ?? "";
  if (value.includes("iphone") || value.includes("ipad") || value.includes("ipod")) {
    return "other";
  }
  if (value.includes("windows")) {
    return "windows";
  }
  if (value.includes("macintosh") || (value.includes("mac os x") && !value.includes("like mac os x"))) {
    return "mac";
  }
  return "other";
}

export function preferredDesktopDownloadLabel(userAgent: string | undefined): string {
  const platform = detectPreferredDesktopPlatform(userAgent);
  if (platform === "mac") {
    return "Download for macOS";
  }
  if (platform === "windows") {
    return "Download for Windows";
  }
  return "Download desktop";
}

export function preferredDesktopDownloadUrl(links: DesktopDownloadLinks, userAgent: string | undefined): string {
  const platform = detectPreferredDesktopPlatform(userAgent);
  if (platform === "mac") {
    return links.macUrl;
  }
  if (platform === "windows") {
    return links.windowsUrl;
  }
  return links.releaseUrl;
}
