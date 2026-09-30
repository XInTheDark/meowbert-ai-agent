import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import type { ProjectFileListResponse } from "../../../lib/types";

interface UseProjectFileListingOptions {
  api: ApiClient;
  projectId: string | null;
  setError: (error: string | null) => void;
  onLoadStart: () => void;
}

export function useProjectFileListing(options: UseProjectFileListingOptions) {
  const [cwd, setCwd] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<ProjectFileListResponse["items"]>([]);
  const [pathInput, setPathInput] = useState("/");
  const [isLoading, setIsLoading] = useState(false);

  const loadFiles = useCallback(async (nextPath = ""): Promise<void> => {
    if (!options.projectId) {
      return;
    }
    setIsLoading(true);
    options.onLoadStart();
    options.setError(null);
    try {
      const response = await options.api.get<ProjectFileListResponse>(
        `/api/projects/${options.projectId}/files?path=${encodeURIComponent(nextPath)}`
      );
      setCwd(response.cwd);
      setParentPath(response.parentPath);
      setEntries(response.items);
    } catch (error) {
      options.setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [options.api, options.onLoadStart, options.projectId, options.setError]);

  useEffect(() => {
    setPathInput(`/${cwd}`);
  }, [cwd]);

  return { cwd, parentPath, entries, pathInput, setPathInput, isLoading, loadFiles };
}
