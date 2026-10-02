import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient } from "../../lib/api";
import type { StorageSummary, StorageSummaryResponse } from "../../lib/types";
import type { FileScope } from "./fileScope";
import { getFileStorageMetrics } from "./fileStorageMetrics";

export type FileStorageStatus = "idle" | "loading" | "ready" | "error";

export function useFileStorage(api: ApiClient, scope: FileScope | null) {
  const filesApiPath = scope?.filesApiPath ?? null;
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [status, setStatus] = useState<FileStorageStatus>("idle");
  const [isExpanded, setIsExpanded] = useState(false);
  const latestRequestRef = useRef(0);
  const load = useCallback(async (): Promise<void> => {
    if (!filesApiPath) {
      return;
    }
    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    setStatus("loading");
    try {
      const response = await api.get<StorageSummaryResponse>(`${filesApiPath}/storage`);
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
  }, [api, filesApiPath]);

  useEffect(() => {
    latestRequestRef.current += 1;
    setSummary(null);
    setStatus("idle");
    setIsExpanded(false);
  }, [filesApiPath]);

  return {
    summary,
    status,
    isExpanded,
    metrics: useMemo(() => getFileStorageMetrics(summary), [summary]),
    setIsExpanded,
    load,
    update: (nextSummary: StorageSummary) => {
      setSummary(nextSummary);
      setStatus("ready");
    }
  };
}
