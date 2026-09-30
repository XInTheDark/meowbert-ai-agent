import { useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import type { ProjectFileEntry, ProjectFilePreview } from "../../../lib/types";

interface UseProjectFilePreviewOptions {
  api: ApiClient;
  projectId: string | null;
  selectedEntry: ProjectFileEntry | null;
  setError: (error: string | null) => void;
}

export function useProjectFilePreview(options: UseProjectFilePreviewOptions) {
  const [preview, setPreview] = useState<ProjectFilePreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!options.projectId || !options.selectedEntry || options.selectedEntry.kind !== "file") {
      setPreview(null);
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);
    options.setError(null);
    void options.api.get<ProjectFilePreview>(
      `/api/projects/${options.projectId}/files/content?path=${encodeURIComponent(options.selectedEntry.relativePath)}`
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
  }, [options.api, options.projectId, options.selectedEntry, options.setError]);

  return { preview, setPreview, isLoading };
}
