import { useCallback, type Dispatch, type SetStateAction } from "react";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import type { FileDeleteResponse, StorageSummary } from "../../lib/types";
import type { FileScope } from "./fileScope";

interface UseFileDeletionOptions {
  scope: FileScope | null;
  cwd: string;
  loadFiles: (path?: string) => Promise<void>;
  updateStorage: (summary: StorageSummary | null) => void;
  setError: Dispatch<SetStateAction<string | null>>;
}

// Confirms, deletes, then refreshes the folder and storage usage.
export function useFileDeletion(options: UseFileDeletionOptions) {
  const { api, setFlash } = useWorkspaceApp();
  const { scope, cwd, loadFiles, updateStorage, setError } = options;

  // Resolves true once the paths are deleted, false if cancelled or failed.
  const deletePaths = useCallback(async (paths: string[]): Promise<boolean> => {
    if (!scope || paths.length === 0) {
      return false;
    }
    const prompt = paths.length === 1
      ? `Delete ${paths[0]} permanently? This cannot be undone.`
      : `Delete ${paths.length} selected item(s) permanently? This cannot be undone.`;
    if (!window.confirm(prompt)) {
      return false;
    }
    setError(null);
    try {
      const result = await api.post<FileDeleteResponse>(`${scope.filesApiPath}/delete`, { paths });
      updateStorage(result.storage);
      await loadFiles(cwd);
      setFlash({ tone: "success", text: result.deletedCount === 1 ? "Deleted 1 item." : `Deleted ${result.deletedCount} items.` });
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return false;
    }
  }, [api, cwd, loadFiles, scope, setError, setFlash, updateStorage]);

  return { deletePaths };
}
