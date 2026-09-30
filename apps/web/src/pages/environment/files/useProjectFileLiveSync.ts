import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { ApiClient } from "../../../lib/api";
import type { FlashMessage, ProjectFileEntry, ProjectFileLiveSyncStatus } from "../../../lib/types";

interface UseProjectFileLiveSyncOptions {
  api: ApiClient;
  projectId: string | null;
  cwd: string;
  selectedEntry: ProjectFileEntry | null;
  loadFiles: (path?: string) => Promise<void>;
  setSelectedPaths: Dispatch<SetStateAction<Set<string>>>;
  setLastSelectedIndex: Dispatch<SetStateAction<number | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setFlash: (message: FlashMessage | null) => void;
}

function formatProviderLabel(provider: NonNullable<ProjectFileEntry["liveSync"]>["provider"]): string {
  if (provider === "google-drive") {
    return "Google Drive";
  }
  if (provider === "pcloud") {
    return "pCloud";
  }
  if (provider === "rclone") {
    return "rclone";
  }
  return "OneDrive";
}

export function useProjectFileLiveSync(options: UseProjectFileLiveSyncOptions) {
  const [status, setStatus] = useState<ProjectFileLiveSyncStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [isMutating, setIsMutating] = useState(false);

  const refreshSelection = useCallback(async (relativePath: string): Promise<void> => {
    await options.loadFiles(options.cwd);
    options.setSelectedPaths(new Set([relativePath]));
    options.setLastSelectedIndex(null);
  }, [options.cwd, options.loadFiles, options.setLastSelectedIndex, options.setSelectedPaths]);

  useEffect(() => {
    if (!options.projectId || !options.selectedEntry?.liveSync || options.selectedEntry.kind !== "file") {
      setStatus(null);
      setIsLoadingStatus(false);
      return;
    }
    let active = true;
    setIsLoadingStatus(true);
    void options.api.get<ProjectFileLiveSyncStatus>(
      `/api/projects/${options.projectId}/files/live-sync?path=${encodeURIComponent(options.selectedEntry.relativePath)}`
    ).then((nextStatus) => {
      if (active) {
        setStatus(nextStatus);
      }
    }).catch((error: unknown) => {
      if (active) {
        setStatus(null);
        options.setError((current) => current ?? (error instanceof Error ? error.message : String(error)));
      }
    }).finally(() => {
      if (active) {
        setIsLoadingStatus(false);
      }
    });
    return () => {
      active = false;
    };
  }, [options.api, options.projectId, options.selectedEntry, options.setError]);

  const mutate = useCallback(async (action: "pull" | "push", force = false): Promise<void> => {
    const liveSync = options.selectedEntry?.liveSync;
    if (!options.projectId || !liveSync || !options.selectedEntry) {
      return;
    }
    if (force) {
      const noun = liveSync.linkKind === "folder" ? "folder" : "file";
      const confirmed = window.confirm(action === "pull"
        ? `Force pull and discard unsynced local changes from this ${noun}?`
        : `Force push and overwrite newer remote ${formatProviderLabel(liveSync.provider)} changes?`);
      if (!confirmed) {
        return;
      }
    }
    setIsMutating(true);
    options.setError(null);
    try {
      const nextStatus = await options.api.post<ProjectFileLiveSyncStatus>(
        `/api/projects/${options.projectId}/files/live-sync/${action}`,
        { path: options.selectedEntry.relativePath, force }
      );
      setStatus(nextStatus);
      await refreshSelection(options.selectedEntry.relativePath);
      options.setFlash({ tone: "success", text: action === "pull" ? (force ? "Latest remote version pulled." : "Live sync item pulled.") : (force ? "Local copy pushed and remote changes overwritten." : "Live sync item pushed.") });
    } catch (error) {
      options.setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsMutating(false);
    }
  }, [options.api, options.projectId, options.selectedEntry, options.setError, options.setFlash, refreshSelection]);

  const unlink = useCallback(async (): Promise<void> => {
    if (!options.projectId || !options.selectedEntry?.liveSync || !window.confirm("Unlink this live sync file? The local working copy will stay in the project.")) {
      return;
    }
    setIsMutating(true);
    options.setError(null);
    try {
      await options.api.post(`/api/projects/${options.projectId}/files/live-sync/unlink`, { path: options.selectedEntry.relativePath });
      setStatus(null);
      await refreshSelection(options.selectedEntry.relativePath);
      options.setFlash({ tone: "success", text: "Live sync removed. The local file is still there." });
    } catch (error) {
      options.setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsMutating(false);
    }
  }, [options.api, options.projectId, options.selectedEntry, options.setError, options.setFlash, refreshSelection]);

  return {
    status,
    isLoadingStatus,
    isMutating,
    mutate,
    unlink,
    openRemote: () => {
      const remoteUrl = status?.remote?.webUrl ?? options.selectedEntry?.liveSync?.remoteWebUrl ?? null;
      if (remoteUrl) {
        window.open(remoteUrl, "_blank", "noopener,noreferrer");
      }
    },
    reset: () => setStatus(null)
  };
}
