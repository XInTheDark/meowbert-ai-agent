import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../../lib/api";
import type { ProjectFileListResponse } from "../../lib/types";
import type { FileScope } from "./fileScope";

interface UseFileListingOptions {
  api: ApiClient;
  scope: FileScope | null;
  setError: (error: string | null) => void;
  onLoadStart: () => void;
}

export function useFileListing(options: UseFileListingOptions) {
  const [cwd, setCwd] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<ProjectFileListResponse["items"]>([]);
  const [pathInput, setPathInput] = useState("/");
  const [isLoading, setIsLoading] = useState(false);
  const filesApiPath = options.scope?.filesApiPath ?? null;

  const loadFiles = useCallback(async (nextPath = ""): Promise<void> => {
    if (!filesApiPath) {
      return;
    }
    setIsLoading(true);
    options.onLoadStart();
    options.setError(null);
    try {
      const response = await options.api.get<ProjectFileListResponse>(`${filesApiPath}?path=${encodeURIComponent(nextPath)}`);
      setCwd(response.cwd);
      setParentPath(response.parentPath);
      setEntries(response.items);
    } catch (error) {
      options.setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsLoading(false);
    }
  }, [filesApiPath, options.api, options.onLoadStart, options.setError]);

  useEffect(() => {
    setPathInput(`/${cwd}`);
  }, [cwd]);

  return { cwd, parentPath, entries, pathInput, setPathInput, isLoading, loadFiles };
}
