import { useCallback, useEffect, useState } from "react";
import type { SetURLSearchParams } from "react-router-dom";
import { desktopGithubReturnOrigin } from "../../../desktop/platform";
import type { ApiClient } from "../../../lib/api";
import type { FlashMessage } from "../../../lib/types";
import type {
  WorkspaceSourceConnectStartResponse,
  WorkspaceSourceListResponse,
  WorkspaceSourceManualConfigResponse,
  WorkspaceSourceSummary
} from "../../../sources/sourceTypes";

interface UseWorkspaceSourcesInput {
  api: ApiClient;
  activeWorkspaceId: string;
  capabilities: { isDesktop: boolean };
  platform: { openExternal: (url: string) => Promise<void> };
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
  setFlash: (flash: FlashMessage | null) => void;
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useWorkspaceSources(input: UseWorkspaceSourcesInput) {
  const [sources, setSources] = useState<WorkspaceSourceSummary[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const oauthStatus = input.searchParams.get("source_oauth");

  const loadSources = useCallback(async () => {
    if (!input.activeWorkspaceId) {
      setSources([]);
      setCanManage(false);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await input.api.get<WorkspaceSourceListResponse>(
        `/api/workspaces/${input.activeWorkspaceId}/sources`
      );
      setSources(response.sources);
      setCanManage(response.canManage);
    } catch (loadError) {
      setSources([]);
      setCanManage(false);
      setError(readErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [input.activeWorkspaceId, input.api]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  useEffect(() => {
    if (!oauthStatus) {
      return;
    }

    input.setFlash({
      tone: oauthStatus === "success" ? "success" : "error",
      text:
        oauthStatus === "success"
          ? "Source connected for this workspace."
          : "Source connection was cancelled or failed."
    });

    input.setSearchParams((currentParams) => {
      const nextParams = new URLSearchParams(currentParams);
      nextParams.delete("source_oauth");
      return nextParams;
    }, { replace: true });
    void loadSources();
  }, [oauthStatus, input.setFlash, input.setSearchParams, loadSources]);

  const handleConnect = useCallback(async (source: WorkspaceSourceSummary): Promise<void> => {
    if (!input.activeWorkspaceId) {
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      const response = await input.api.post<WorkspaceSourceConnectStartResponse>(
        `/api/workspaces/${input.activeWorkspaceId}/sources/${source.id}/connect/start`,
        {
          returnOrigin: input.capabilities.isDesktop ? desktopGithubReturnOrigin() : window.location.origin
        },
        { credentials: "include" }
      );

      if (input.capabilities.isDesktop) {
        await input.platform.openExternal(response.authorizeUrl);
        input.setFlash({
          tone: "success",
          text: `${source.name} opened in your browser. Finish the connection there, then return here and refresh.`
        });
        return;
      }

      window.location.assign(response.authorizeUrl);
    } catch (connectError) {
      setError(readErrorMessage(connectError));
    } finally {
      setIsSaving(false);
    }
  }, [input.activeWorkspaceId, input.api, input.capabilities.isDesktop, input.platform, input.setFlash]);

  const handleDisconnect = useCallback(async (source: WorkspaceSourceSummary): Promise<void> => {
    if (
      !input.activeWorkspaceId
      || !window.confirm(`Disconnect ${source.name} for this workspace?`)
    ) {
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await input.api.delete(`/api/workspaces/${input.activeWorkspaceId}/sources/${source.id}`);
      await loadSources();
      input.setFlash({ tone: "success", text: `${source.name} disconnected.` });
    } catch (disconnectError) {
      setError(readErrorMessage(disconnectError));
    } finally {
      setIsSaving(false);
    }
  }, [input.activeWorkspaceId, input.api, input.setFlash, loadSources]);

  const handleConfigureRclone = useCallback(async (
    source: WorkspaceSourceSummary,
    configInput: { rcloneConfig: string; remoteName: string; baseDirectory: string }
  ): Promise<void> => {
    if (!input.activeWorkspaceId) {
      return;
    }

    setError(null);
    setIsSaving(true);
    try {
      await input.api.put<WorkspaceSourceManualConfigResponse>(
        `/api/workspaces/${input.activeWorkspaceId}/sources/${source.id}/config`,
        {
          rcloneConfig: configInput.rcloneConfig,
          remoteName: configInput.remoteName,
          baseDirectory: configInput.baseDirectory.trim() || null
        }
      );
      await loadSources();
      input.setFlash({ tone: "success", text: `${source.name} source saved.` });
    } catch (configError) {
      setError(readErrorMessage(configError));
    } finally {
      setIsSaving(false);
    }
  }, [input.activeWorkspaceId, input.api, input.setFlash, loadSources]);

  return {
    sources,
    canManage,
    isLoading,
    isSaving,
    error,
    loadSources,
    handleConnect,
    handleDisconnect,
    handleConfigureRclone
  };
}
