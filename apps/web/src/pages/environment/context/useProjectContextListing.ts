import { useCallback, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import type { ProjectFileEntry, ProjectFileListResponse } from "../../../lib/types";
import { buildProjectContextPath } from "../../../lib/utils";
import { stripContextPrefix } from "./contextPaths";

interface UseProjectContextListingOptions {
  api: ApiClient;
  projectId: string | null;
  setError: (error: string | null) => void;
  onLoadStart: () => void;
}

// Lists a folder inside the project's context. A context folder that doesn't exist yet is shown empty.
export function useProjectContextListing(options: UseProjectContextListingOptions) {
  const { api, projectId, setError, onLoadStart } = options;
  const [cwd, setCwd] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<ProjectFileEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const loadEntries = useCallback(async (nextPath = ""): Promise<void> => {
    if (!projectId) {
      return;
    }
    setIsLoading(true);
    setError(null);
    onLoadStart();
    try {
      const response = await api.get<ProjectFileListResponse>(
        `/api/projects/${projectId}/files?path=${encodeURIComponent(buildProjectContextPath(nextPath))}`
      );
      setCwd(stripContextPrefix(response.cwd));
      setParentPath(response.parentPath ? stripContextPrefix(response.parentPath) : null);
      setEntries(response.items);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Directory not found") {
        setCwd(nextPath);
        setParentPath(nextPath ? nextPath.split("/").slice(0, -1).join("/") || "" : null);
        setEntries([]);
        return;
      }
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [api, onLoadStart, projectId, setError]);

  const removeEntries = useCallback((deletedPaths: string[]) => {
    setEntries((current) => current.filter((entry) => !deletedPaths.some((deletedPath) => (
      entry.relativePath === deletedPath || entry.relativePath.startsWith(`${deletedPath}/`)
    ))));
  }, []);

  const setEntryNote = useCallback((relativePath: string, note: string | null) => {
    setEntries((current) => current.map((entry) => (entry.relativePath === relativePath ? { ...entry, note } : entry)));
  }, []);

  return { cwd, parentPath, entries, isLoading, loadEntries, removeEntries, setEntryNote };
}

export type ProjectContextListing = ReturnType<typeof useProjectContextListing>;
