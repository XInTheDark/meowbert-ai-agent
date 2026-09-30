import { useEffect, useMemo, useState } from "react";
import { getInlineFilePreviewKind } from "../../../components/files/filePreviewKinds";
import type { ApiClient } from "../../../lib/api";
import type { EnvironmentFileEntry, EnvironmentFilePreview } from "../../../lib/types";
import { buildDownloadUrl } from "../../../lib/utils";
import { buildTaskArtifactDownloadPath } from "../../../task/taskFileDestinations";

interface UseTaskArtifactPreviewOptions {
  api: ApiClient;
  projectId: string | null;
  taskRootPath: string | null;
  entry: EnvironmentFileEntry | null;
}

interface TaskArtifactPreviewState {
  preview: EnvironmentFilePreview | null;
  isLoading: boolean;
  error: string | null;
  downloadUrl: string | null;
}

export function useTaskArtifactPreview(options: UseTaskArtifactPreviewOptions): TaskArtifactPreviewState {
  const [preview, setPreview] = useState<EnvironmentFilePreview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectRelativePath = useMemo(
    () => options.entry
      ? buildTaskArtifactDownloadPath(options.taskRootPath, options.entry.relativePath)
      : null,
    [options.entry, options.taskRootPath]
  );

  useEffect(() => {
    setPreview(null);
    setError(null);
    if (!options.entry || !projectRelativePath || !options.projectId) {
      setIsLoading(false);
      return;
    }
    if (getInlineFilePreviewKind(options.entry.relativePath)) {
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);
    void options.api.get<EnvironmentFilePreview>(
      `/api/projects/${options.projectId}/files/content?path=${encodeURIComponent(projectRelativePath)}`
    ).then((nextPreview) => {
      if (active) {
        setPreview(nextPreview);
      }
    }).catch((previewError: unknown) => {
      if (active) {
        setError(previewError instanceof Error ? previewError.message : "Preview unavailable");
      }
    }).finally(() => {
      if (active) {
        setIsLoading(false);
      }
    });

    return () => {
      active = false;
    };
  }, [options.api, options.entry, options.projectId, projectRelativePath]);

  return {
    preview,
    isLoading,
    error,
    downloadUrl: options.projectId && projectRelativePath
      ? buildDownloadUrl(options.projectId, projectRelativePath)
      : null
  };
}
