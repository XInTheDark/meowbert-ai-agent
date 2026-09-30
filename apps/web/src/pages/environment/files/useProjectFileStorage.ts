import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../../../lib/api";
import type { StorageSummary, StorageSummaryResponse } from "../../../lib/types";
import { getProjectFileStorageMetrics } from "./projectFileStorage";

export type ProjectFileStorageStatus = "idle" | "loading" | "ready" | "error";

export function useProjectFileStorage(api: ApiClient, projectId: string | null) {
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [status, setStatus] = useState<ProjectFileStorageStatus>("idle");
  const [isExpanded, setIsExpanded] = useState(false);
  const latestRequestRef = useRef(0);
  const load = useCallback(async (): Promise<void> => {
    if (!projectId) {
      return;
    }
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    setStatus("loading");
    try {
      const response = await api.get<StorageSummaryResponse>(`/api/projects/${projectId}/files/storage`);
      if (latestRequestRef.current === requestId) {
        setSummary(response.storage);
        setStatus("ready");
      }
    } catch {
      if (latestRequestRef.current === requestId) {
        setSummary(null);
        setStatus("error");
      }
    }
  }, [api, projectId]);

  useEffect(() => {
    latestRequestRef.current += 1;
    setSummary(null);
    setStatus("idle");
    setIsExpanded(false);
  }, [projectId]);

  return {
    summary,
    status,
    isExpanded,
    metrics: useMemo(() => getProjectFileStorageMetrics(summary), [summary]),
    setIsExpanded,
    load,
    update: (nextSummary: StorageSummary) => {
      setSummary(nextSummary);
      setStatus("ready");
    }
  };
}
