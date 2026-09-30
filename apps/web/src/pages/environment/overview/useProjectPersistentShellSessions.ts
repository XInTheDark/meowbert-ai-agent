import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import type { PersistentShellSessionListResponse, PersistentShellSessionSummary } from "../../../lib/types";

const POLL_INTERVAL_MS = 5_000;

function getPersistentShellSessionsBasePath(input: {
  projectId?: string | null;
  taskId?: string | null;
}): string | null {
  if (input.taskId) return `/api/tasks/${input.taskId}/persistent-shell-sessions`;
  if (input.projectId) return `/api/projects/${input.projectId}/persistent-shell-sessions`;
  return null;
}

export function useProjectPersistentShellSessions(input: {
  api: ApiClient;
  projectId?: string | null;
  taskId?: string | null;
  includeOutput: boolean;
}) {
  const [items, setItems] = useState<PersistentShellSessionSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const refresh = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  const terminateSession = useCallback(async (sessionId: string): Promise<void> => {
    const basePath = getPersistentShellSessionsBasePath(input);
    if (!basePath) return;
    await input.api.post(`${basePath}/${sessionId}/terminate`, {});
    refresh();
  }, [input.api, input.projectId, input.taskId, refresh]);

  const terminateAll = useCallback(async (): Promise<void> => {
    const basePath = getPersistentShellSessionsBasePath(input);
    if (!basePath) return;
    await input.api.post(`${basePath}/terminate-all`, {});
    refresh();
  }, [input.api, input.projectId, input.taskId, refresh]);

  useEffect(() => {
    const scopeId = input.taskId ?? input.projectId;
    if (!scopeId) {
      setItems([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const basePath = getPersistentShellSessionsBasePath(input);
    if (!basePath) return;
    const path = `${basePath}?includeOutput=${input.includeOutput ? "true" : "false"}`
      + (input.includeOutput ? "&outputTailLines=800" : "");
    const load = async (): Promise<void> => {
      try {
        const response = await input.api.get<PersistentShellSessionListResponse>(path);
        if (!cancelled) {
          setItems(response.items);
          setError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    setIsLoading(true);
    void load();
    const poller = window.setInterval(() => { void load(); }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(poller);
    };
  }, [input.api, input.includeOutput, input.projectId, input.taskId, refreshNonce]);

  return { items, isLoading, error, refresh, terminateSession, terminateAll };
}
