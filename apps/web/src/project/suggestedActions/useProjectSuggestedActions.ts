import { useEffect, useState } from "react";
import type { ProjectSuggestedAction } from "@meowbert/shared/memory";
import type { ApiClient } from "../../lib/api";
import { API_CACHE_TTLS } from "../../lib/api-cache";

const MAX_SUGGESTED_ACTIONS = 8;

type SuggestedActionsResponse = { enabled: boolean; actions: ProjectSuggestedAction[] };

function readActions(response: SuggestedActionsResponse | null | undefined): ProjectSuggestedAction[] {
  return response?.enabled && Array.isArray(response.actions)
    ? response.actions.slice(0, MAX_SUGGESTED_ACTIONS)
    : [];
}

// The starter actions a project's memory suggests, served from the API cache first and refreshed in the background.
export function useProjectSuggestedActions(
  api: ApiClient | null | undefined,
  workspaceId: string | null | undefined,
  projectId: string | null | undefined
): ProjectSuggestedAction[] {
  const [actions, setActions] = useState<ProjectSuggestedAction[]>([]);

  useEffect(() => {
    if (!api || !workspaceId || !projectId) {
      setActions([]);
      return;
    }

    const path = `/api/workspaces/${workspaceId}/projects/${projectId}/suggested-actions`;
    const snapshot = api.cachedGet?.<SuggestedActionsResponse>(path, { ttlMs: API_CACHE_TTLS.catalog });
    setActions(readActions(snapshot?.data));

    let cancelled = false;
    void (snapshot?.promise ?? api.get<SuggestedActionsResponse>(path))
      .then((response) => {
        if (!cancelled) setActions(readActions(response));
      })
      .catch(() => {
        if (!cancelled) setActions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, workspaceId]);

  return actions;
}
