const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_DESKTOP_RELEASE_CONFIG = Object.freeze({
  repository: "XInTheDark/meowbert-ai-agent",
  pageUrl: null
});

function isRepositorySlug(value) {
  return typeof value === "string" && /^[^/\s]+\/[^/\s]+$/.test(value.trim());
}

function normalizePageUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  try {
    return new URL(value.trim()).toString();
  } catch {
    return null;
  }
}

function loadDesktopReleaseConfig() {
  const configPath = path.resolve(__dirname, "desktop-release.json");

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const repository = isRepositorySlug(parsed?.repository)
      ? parsed.repository.trim()
      : DEFAULT_DESKTOP_RELEASE_CONFIG.repository;
    const pageUrl = normalizePageUrl(parsed?.pageUrl);
    return {
      repository,
      pageUrl
    };
  } catch {
    return { ...DEFAULT_DESKTOP_RELEASE_CONFIG };
  }
}

function resolveDesktopReleaseEnv(overrides = process.env) {
  const configured = loadDesktopReleaseConfig();
  const repository = isRepositorySlug(overrides.MEOWBERT_DESKTOP_RELEASE_REPOSITORY)
    ? overrides.MEOWBERT_DESKTOP_RELEASE_REPOSITORY.trim()
    : isRepositorySlug(overrides.VITE_DESKTOP_RELEASE_REPOSITORY)
      ? overrides.VITE_DESKTOP_RELEASE_REPOSITORY.trim()
      : configured.repository;
  const pageUrl = normalizePageUrl(overrides.VITE_DESKTOP_RELEASES_PAGE_URL) ?? configured.pageUrl;
  const releasesBaseUrl = `https://github.com/${repository}/releases`;

  return {
    repository,
    pageUrl,
    releasesBaseUrl,
    env: {
      MEOWBERT_DESKTOP_RELEASE_REPOSITORY: repository,
      VITE_DESKTOP_RELEASE_REPOSITORY: repository,
      VITE_DESKTOP_RELEASES_PAGE_URL: pageUrl ?? ""
    }
  };
}

module.exports = {
  DEFAULT_DESKTOP_RELEASE_CONFIG,
  loadDesktopReleaseConfig,
  resolveDesktopReleaseEnv
};
