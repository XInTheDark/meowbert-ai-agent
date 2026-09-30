import { beforeEach, describe, expect, it } from "vitest";
import {
  detectPreferredDesktopPlatform,
  desktopReleasesPageUrl,
  fallbackDesktopDownloadLinks,
  LATEST_DESKTOP_MAC_ASSET_NAME,
  LATEST_DESKTOP_WINDOWS_ASSET_NAME,
  preferredDesktopDownloadLabel,
  preferredDesktopDownloadUrl
} from "./desktopDownloads";

const configuredReleaseUrl = desktopReleasesPageUrl();
const configuredLatestReleaseUrl = `${configuredReleaseUrl.replace(/\/$/, "")}/latest`;

function latestReleaseDownloadUrl(assetName: string): string {
  return `${configuredLatestReleaseUrl}/download/${encodeURIComponent(assetName)}`;
}

describe("desktop download helpers", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      window.localStorage.clear();
    }
  });

  it("builds direct latest-release download URLs", () => {
    const links = fallbackDesktopDownloadLinks();

    expect(links.releaseUrl).toBe(configuredLatestReleaseUrl);
    expect(links.macUrl).toBe(latestReleaseDownloadUrl(LATEST_DESKTOP_MAC_ASSET_NAME));
    expect(links.windowsUrl).toBe(latestReleaseDownloadUrl(LATEST_DESKTOP_WINDOWS_ASSET_NAME));
  });

  it("detects mac and Windows browsers for the hero CTA", () => {
    expect(detectPreferredDesktopPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
    expect(detectPreferredDesktopPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectPreferredDesktopPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X)")).toBe("other");
    expect(detectPreferredDesktopPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("other");
  });

  it("picks the best CTA label and URL for the current platform", () => {
    const links = {
      releaseUrl: "https://example.com/releases/latest",
      macUrl: "https://example.com/mac.dmg",
      windowsUrl: "https://example.com/win.exe",
      version: null,
      publishedAt: null
    };

    expect(preferredDesktopDownloadLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("Download for macOS");
    expect(preferredDesktopDownloadUrl(links, "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("https://example.com/mac.dmg");
    expect(preferredDesktopDownloadLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("Download for Windows");
    expect(preferredDesktopDownloadUrl(links, "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("https://example.com/win.exe");
    expect(preferredDesktopDownloadLabel(undefined)).toBe("Download desktop");
    expect(preferredDesktopDownloadUrl(links, undefined)).toBe("https://example.com/releases/latest");
  });
});
