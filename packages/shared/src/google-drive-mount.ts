// Both the server FUSE mount and desktop NFS mount use the same Drive view.
export function buildGoogleDriveMountConfig(input: {
  clientId: string; clientSecret: string; rootFolderId: string;
  tokens: { accessToken: string; refreshToken: string | null; tokenType: string | null; expiresAt: string | null };
}): string {
  for (const value of [input.clientId, input.clientSecret, input.rootFolderId]) {
    if (!value || /[\r\n\u0000]/.test(value)) throw new Error("Invalid Google Drive mount configuration.");
  }
  const token = JSON.stringify({ access_token: input.tokens.accessToken, token_type: input.tokens.tokenType ?? "Bearer",
    refresh_token: input.tokens.refreshToken, expiry: input.tokens.expiresAt });
  return ["[google-drive]", "type = drive", "client_id = " + input.clientId,
    "client_secret = " + input.clientSecret, "token = " + token, "root_folder_id = " + input.rootFolderId, ""].join("\n");
}

export function googleDriveMountArgs(input: { configPath: string; mountPoint: string; transport: "fuse" | "nfs"; cacheDir?: string }): string[] {
  return ["--config", input.configPath, input.transport === "nfs" ? "nfsmount" : "mount", "google-drive:", input.mountPoint,
    "--vfs-cache-mode", "full", "--vfs-write-back", "1s", "--vfs-cache-max-size", "10G",
    "--vfs-fast-fingerprint", "--dir-cache-time", "30m", "--drive-pacer-min-sleep", "100ms",
    "--drive-export-formats", "url", ...(input.transport === "fuse" ? ["--allow-other"] : []),
    "--timeout", "10s", "--contimeout", "5s", "--low-level-retries", "2", "--retries", "1",
    ...(input.cacheDir ? ["--cache-dir", input.cacheDir] : [])];
}

export interface LocalLiveFolder {
  linkId: string; connectionId: string; accountLabel: string; localRelativePath: string;
}
export interface LocalLiveFolderConfig extends LocalLiveFolder { config: string }
