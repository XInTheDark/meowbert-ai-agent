import { useEffect, useState } from "react";

/**
 * When the current run started: the server's time when it is known, otherwise the moment this page
 * first saw the task running. Null while nothing is running.
 */
export function useRunningSince(isRunning: boolean, serverStartedAt: string | null | undefined): string | null {
  const [observedSince, setObservedSince] = useState<string | null>(null);
  useEffect(() => {
    setObservedSince(isRunning ? new Date().toISOString() : null);
  }, [isRunning]);
  if (!isRunning) return null;
  return serverStartedAt ?? observedSince;
}
