// @ts-ignore – CHANGELOG.md is at the repo root (four levels above apps/web/src/lib/)
import rawChangelog from "../../../../CHANGELOG.md?raw";

export { rawChangelog };

export const CHANGELOG_SEEN_KEY = "meowbert_changelog_seen";

/** Returns the top-most date header from the changelog, used as the "version". */
export function getLatestChangelogVersion(): string {
  const match = rawChangelog.match(/^## (.+)$/m);
  return match ? match[1].trim() : "";
}

export function hasUnseenChangelog(): boolean {
  const latest = getLatestChangelogVersion();
  return latest !== "" && localStorage.getItem(CHANGELOG_SEEN_KEY) !== latest;
}

export function markChangelogSeen(): void {
  localStorage.setItem(CHANGELOG_SEEN_KEY, getLatestChangelogVersion());
}
