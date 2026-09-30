export function formatDesktopVersion(version: string): string {
  const normalizedVersion = version.trim();
  if (!normalizedVersion) {
    return version;
  }

  const prereleaseMatch = /^\d+\.\d+\.\d+-([0-9A-Za-z.-]+)(?:\+.+)?$/.exec(normalizedVersion);
  if (prereleaseMatch) {
    return prereleaseMatch[1];
  }

  return normalizedVersion.replace(/\+.+$/, "");
}
