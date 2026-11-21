import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentSwarmNoteView } from "@meowbert/shared/agent-swarm-view";
import type { ApiClient } from "../../../lib/api";

const SHARED_NOTES_POLL_INTERVAL_MS = 4_000;

// Polls explicit `share` notes for a swarm in chronological order.
export function useSwarmSharedNotes(input: {
  api: ApiClient;
  swarmTaskId: string;
  active: boolean;
}) {
  const { api, swarmTaskId, active } = input;
  const [notes, setNotes] = useState<AgentSwarmNoteView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const response = await api.get<{ notes: AgentSwarmNoteView[] }>(
        `/api/tasks/${swarmTaskId}/swarm/notes?kind=shared`
      );
      if (requestId !== requestIdRef.current) return;
      setNotes(response.notes.filter((note) => note.kind === "shared"));
      setError(null);
    } catch (loadError) {
      if (requestId === requestIdRef.current) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [api, swarmTaskId]);

  useEffect(() => {
    setIsLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void load(), SHARED_NOTES_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, load]);

  return { notes, isLoading, error };
}
