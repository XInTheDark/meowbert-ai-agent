import { useEffect, useState } from "react";
import type { ApiClient } from "../../lib/api";
import type { ProjectFileEntry, ProjectFilePreview } from "../../lib/types";
import type { FileScope } from "./fileScope";

interface UseFilePreviewOptions {
  api: ApiClient;
  scope: FileScope | null;
  selectedEntry: ProjectFileEntry | null;
  setError: (error: string | null) => void;
}

export function useFilePreview(options: UseFilePreviewOptions) {
  const [preview, setPreview] = useState<ProjectFilePreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const filesApiPath = options.scope?.filesApiPath ?? null;

  useEffect(() => {
    if (!filesApiPath || !options.selectedEntry || options.selectedEntry.kind !== "file") {
      setPreview(null);
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);
    options.setError(null);
    void options.api.get<ProjectFilePreview>(
      `${filesApiPath}/content?path=${encodeURIComponent(options.selectedEntry.relativePath)}`
    ).then((nextPreview) => {
      if (active) {
        setPreview(nextPreview);
      }
    }).catch(() => undefined).finally(() => {
      if (active) {
        setIsLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [filesApiPath, options.api, options.selectedEntry, options.setError]);

  return { preview, setPreview, isLoading };
}
