// The last measured usage per workspace, so upload checks don't rescan the whole tree.
// Every full scan refreshes it and saved files add their size until it expires. It is kept
// per API process: each instance rescans at most once per TTL, which is fine for a soft limit.
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 5_000;

const usedBytesByWorkspace = new Map<string, { usedBytes: number; expiresAt: number }>();

export function rememberWorkspaceUsedBytes(workspaceId: string, usedBytes: number): void {
  usedBytesByWorkspace.delete(workspaceId);
  if (usedBytesByWorkspace.size >= MAX_ENTRIES) {
    const oldestKey = usedBytesByWorkspace.keys().next().value;
    if (oldestKey !== undefined) usedBytesByWorkspace.delete(oldestKey);
  }
  usedBytesByWorkspace.set(workspaceId, { usedBytes: Math.max(0, usedBytes), expiresAt: Date.now() + CACHE_TTL_MS });
}

export function readRememberedWorkspaceUsedBytes(workspaceId: string): number | null {
  const entry = usedBytesByWorkspace.get(workspaceId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    usedBytesByWorkspace.delete(workspaceId);
    return null;
  }
  return entry.usedBytes;
}

export function addToRememberedWorkspaceUsedBytes(workspaceId: string, bytes: number): void {
  const entry = usedBytesByWorkspace.get(workspaceId);
  if (entry && entry.expiresAt > Date.now()) {
    entry.usedBytes = Math.max(0, entry.usedBytes + bytes);
  }
}
