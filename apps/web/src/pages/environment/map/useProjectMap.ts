import { useCallback, useEffect, useMemo, useState } from "react";
import type { ProjectMap } from "@meowbert/shared/project-map";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";
import { createProjectMapApi, type ProjectMapApi } from "./projectMapApi";

// Task status changes without a map edit, so the map refreshes while it is on screen.
const REFRESH_INTERVAL_MS = 15_000;

export function useProjectMap(projectId: string) {
  const { api } = useWorkspaceApp();
  const mapApi = useMemo(() => createProjectMapApi(api, projectId), [api, projectId]);
  const [map, setMap] = useState<ProjectMap | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const clearMutationError = useCallback(() => setMutationError(null), []);
  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    void mapApi.load()
      .then((next) => { if (!cancelled) { setMap(next); setLoadError(null); } })
      .catch((failure) => { if (!cancelled) setLoadError(failure instanceof Error ? failure.message : "Unable to load the map."); });
    return () => { cancelled = true; };
  }, [mapApi, nonce]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") refresh(); }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // Runs an edit, then reloads; a failed edit is shown instead of thrown.
  const run = useCallback(async (edit: (client: ProjectMapApi) => Promise<unknown>): Promise<boolean> => {
    try {
      await edit(mapApi);
      setMutationError(null);
      return true;
    } catch (failure) {
      setMutationError(failure instanceof Error ? failure.message : "The change could not be saved.");
      return false;
    } finally {
      refresh();
    }
  }, [mapApi, refresh]);

  return { map, error: mutationError ?? loadError, mutationError, clearMutationError, refresh, run };
}

export type ProjectMapController = ReturnType<typeof useProjectMap>;
