export const RCLONE_SOURCE_DISABLED_MESSAGE =
  "The rclone source is temporarily disabled because tenant-provided backends can access API runtime paths.";

// SECURITY: rclone supports local and wrapper backends that can escape tenant
// storage when its configuration is executed inside the privileged API runtime.
// Keep every rclone path disabled until it runs in an isolated sandbox with a
// recursively validated network-only backend allowlist.
export function isSourceProviderRuntimeEnabled(provider: string): boolean {
  return provider !== "rclone";
}

export function assertSourceProviderRuntimeEnabled(provider: string): void {
  if (!isSourceProviderRuntimeEnabled(provider)) {
    throw new Error(RCLONE_SOURCE_DISABLED_MESSAGE);
  }
}
