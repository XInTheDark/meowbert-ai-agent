import { useEffect, useMemo, useState } from "react";
import type { ApiClient } from "../lib/api";
import { canAttachWorkspaceSource, type WorkspaceSourceListResponse, type WorkspaceSourceSummary } from "./sourceTypes";

// The workspace's connected sources that files can be attached from.
export function useAttachableSources(api: ApiClient, workspaceId: string | null | undefined): WorkspaceSourceSummary[] {
  const [sources, setSources] = useState<WorkspaceSourceSummary[]>([]);

  useEffect(() => {
    if (!workspaceId) {
      setSources([]);
      return;
    }
    void api.get<WorkspaceSourceListResponse>(`/api/workspaces/${workspaceId}/sources`)
      .then((response) => setSources(response.sources))
      .catch(() => setSources([]));
  }, [api, workspaceId]);

  return useMemo(() => sources.filter((source) => canAttachWorkspaceSource(source)), [sources]);
}
