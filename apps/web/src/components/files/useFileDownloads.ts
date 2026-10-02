import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { triggerAuthenticatedBrowserDownload } from "../../lib/authenticated-download";
import type { FileScope } from "./fileScope";

interface UseFileDownloadsOptions {
  scope: FileScope | null;
  cwd: string;
  setError: Dispatch<SetStateAction<string | null>>;
}

export function useFileDownloads(options: UseFileDownloadsOptions) {
  const { token, setFlash } = useWorkspaceApp();
  const { platform, capabilities } = useAppRuntime();
  const [isDownloading, setIsDownloading] = useState(false);

  const download = useCallback(async (paths: string[]): Promise<void> => {
    const scope = options.scope;
    if (!scope || paths.length === 0 || isDownloading) {
      return;
    }
    const url = paths.length === 1
      ? scope.downloadUrl(paths[0])
      : scope.batchDownloadUrl(paths, options.cwd);
    const suggestedFilename = paths.length === 1
      ? paths[0].split("/").pop() ?? "download"
      : `${scope.archiveName}-${Date.now()}.zip`;
    setIsDownloading(true);
    options.setError(null);
    try {
      if (capabilities.supportsNativeDownloads) {
        const result = await platform.saveUrlToFile({ url, token, suggestedFilename });
        if (!result.canceled) {
          setFlash({ tone: "success", text: paths.length === 1 ? "File saved." : "Archive saved." });
        }
        return;
      }
      await triggerAuthenticatedBrowserDownload({ url, token, suggestedFilename });
    } catch (error) {
      options.setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsDownloading(false);
    }
  }, [capabilities.supportsNativeDownloads, isDownloading, options.cwd, options.scope, options.setError, platform, setFlash, token]);

  return { isDownloading, download };
}
