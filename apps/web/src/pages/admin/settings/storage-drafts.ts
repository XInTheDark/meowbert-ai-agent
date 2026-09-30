import type { AdminStorageOverview } from "./shared";

export function buildWorkspaceBackendDrafts(
  storage: AdminStorageOverview,
  previousDrafts: Record<string, string> = {}
): Record<string, string> {
  const configuredBackendIds = new Set(storage.backends.map((backend) => backend.id));

  return Object.fromEntries(
    storage.workspaces.map((workspace) => {
      const previousDraft = previousDrafts[workspace.id]?.trim();
      const nextDraft =
        previousDraft && configuredBackendIds.has(previousDraft)
          ? previousDraft
          : workspace.storageBackendId;

      return [workspace.id, nextDraft];
    })
  );
}
