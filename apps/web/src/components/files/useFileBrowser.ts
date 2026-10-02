import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../lib/api";
import type { FileScope } from "./fileScope";
import { useFileDeletion } from "./useFileDeletion";
import { useFileDownloads } from "./useFileDownloads";
import { useFileListing } from "./useFileListing";
import { useFilePreview } from "./useFilePreview";
import { useFileSelection } from "./useFileSelection";
import { useFileStorage } from "./useFileStorage";
import { useFileUploads } from "./useFileUploads";

interface UseFileBrowserOptions {
  api: ApiClient;
  scope: FileScope | null;
  initialPath: string;
  // Closes menus the page adds on top of the browser (for example a cleanup menu).
  onCloseExtraMenus?: () => void;
}

// Everything a file browser page needs for one scope: listing, selection, preview, storage,
// uploads, downloads and deletion, wired together and reloaded when the scope changes.
export function useFileBrowser(options: UseFileBrowserOptions) {
  const { api, scope, initialPath, onCloseExtraMenus } = options;
  const [error, setError] = useState<string | null>(null);
  const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
  const closeActionMenus = useCallback(() => {
    setIsUploadMenuOpen(false);
    onCloseExtraMenus?.();
  }, [onCloseExtraMenus]);

  const resetSelectionRef = useRef<() => void>(() => undefined);
  const handleLoadStart = useCallback(() => resetSelectionRef.current(), []);
  const listing = useFileListing({ api, scope, setError, onLoadStart: handleLoadStart });
  const { cwd, loadFiles } = listing;
  const selection = useFileSelection({
    entries: listing.entries,
    onOpenDirectory: (relativePath) => {
      void loadFiles(relativePath);
    },
    onContextMenuOpening: closeActionMenus
  });
  resetSelectionRef.current = selection.resetSelection;
  const preview = useFilePreview({ api, scope, selectedEntry: selection.selectedEntry, setError });
  const storage = useFileStorage(api, scope);
  const closeMenus = useCallback(() => {
    selection.setContextMenu(null);
    closeActionMenus();
  }, [closeActionMenus, selection.setContextMenu]);
  const uploads = useFileUploads({
    scope,
    cwd,
    storageStatus: storage.status,
    loadFiles,
    loadStorageSummary: storage.load,
    setError,
    onPickerOpening: closeMenus
  });
  const downloads = useFileDownloads({ scope, cwd, setError });
  const deletion = useFileDeletion({ scope, cwd, loadFiles, updateStorage: storage.update, setError });

  useEffect(() => {
    closeActionMenus();
    setError(null);
    void loadFiles(initialPath);
  }, [scope?.key, closeActionMenus, initialPath, loadFiles]);

  return {
    error,
    setError,
    isUploadMenuOpen,
    setIsUploadMenuOpen,
    closeMenus,
    listing,
    selection,
    preview,
    storage,
    uploads,
    downloads,
    deletion
  };
}

export type FileBrowser = ReturnType<typeof useFileBrowser>;
