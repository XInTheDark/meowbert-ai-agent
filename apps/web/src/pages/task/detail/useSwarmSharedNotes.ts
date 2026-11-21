import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentSwarmNoteView } from "@meowbert/shared/agent-swarm-view";
import type { ApiClient } from "../../../lib/api";

export type SwarmNotesFilter = "lane" | "all";

interface SwarmNotesResponse {
  notes: AgentSwarmNoteView[];
  hasOlder?: boolean;
  totalCount?: number;
  laneCount?: number;
}

const SHARED_NOTES_POLL_INTERVAL_MS = 4_000;

function buildSwarmNotesUrl(input: {
  swarmTaskId: string;
  laneId: string;
  filter: SwarmNotesFilter;
  afterSeq?: string;
  beforeSeq?: string;
}): string {
  const params = new URLSearchParams({ kind: "shared" });
  if (input.filter === "lane") params.set("laneId", input.laneId);
  else params.set("countLaneId", input.laneId);
  if (input.afterSeq) params.set("after", input.afterSeq);
  if (input.beforeSeq) params.set("before", input.beforeSeq);
  return `/api/tasks/${input.swarmTaskId}/swarm/notes?${params.toString()}`;
}

function filterScopeNotes(
  notes: AgentSwarmNoteView[],
  filter: SwarmNotesFilter,
  laneId: string
): AgentSwarmNoteView[] {
  return notes.filter((note) => note.kind === "shared" && (filter === "all" || note.laneId === laneId));
}

function mergeNotesBySeq(
  existing: AgentSwarmNoteView[],
  incoming: AgentSwarmNoteView[],
  position: "prepend" | "append"
): AgentSwarmNoteView[] {
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((note) => note.seq));
  const uniqueIncoming = incoming.filter((note) => !seen.has(note.seq));
  if (uniqueIncoming.length === 0) return existing;
  return position === "prepend" ? [...uniqueIncoming, ...existing] : [...existing, ...uniqueIncoming];
}

// Loads the most recent page of shared notes in chronological order, supports paging older notes, and polls incrementally.
export function useSwarmSharedNotes(input: {
  api: ApiClient;
  swarmTaskId: string;
  laneId: string;
  filter: SwarmNotesFilter;
  active: boolean;
}) {
  const { api, swarmTaskId, laneId, filter, active } = input;
  const [notes, setNotes] = useState<AgentSwarmNoteView[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [laneCount, setLaneCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const latestSeqRef = useRef<string | null>(null);
  const oldestSeqRef = useRef<string | null>(null);
  latestSeqRef.current = notes[notes.length - 1]?.seq ?? null;
  oldestSeqRef.current = notes[0]?.seq ?? null;

  const applyCounts = useCallback((response: SwarmNotesResponse, rawShared: AgentSwarmNoteView[]) => {
    setTotalCount(typeof response.totalCount === "number" ? response.totalCount : rawShared.length);
    setLaneCount(typeof response.laneCount === "number"
      ? response.laneCount
      : rawShared.filter((note) => note.laneId === laneId).length);
  }, [laneId]);

  const loadLatestPage = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    try {
      const response = await api.get<SwarmNotesResponse>(
        buildSwarmNotesUrl({ swarmTaskId, laneId, filter })
      );
      if (requestId !== requestIdRef.current) return;
      const rawShared = response.notes.filter((note) => note.kind === "shared");
      setNotes(filterScopeNotes(rawShared, filter, laneId));
      setHasOlder(response.hasOlder === true);
      applyCounts(response, rawShared);
      setError(null);
    } catch (loadError) {
      if (requestId === requestIdRef.current) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [api, applyCounts, filter, laneId, swarmTaskId]);

  const pollNewer = useCallback(async () => {
    const scopeRequestId = requestIdRef.current;
    const afterSeq = latestSeqRef.current;
    try {
      const response = await api.get<SwarmNotesResponse>(
        buildSwarmNotesUrl({ swarmTaskId, laneId, filter, ...(afterSeq ? { afterSeq } : {}) })
      );
      if (scopeRequestId !== requestIdRef.current) return;
      const rawShared = response.notes.filter((note) => note.kind === "shared");
      const scoped = filterScopeNotes(rawShared, filter, laneId);
      if (afterSeq) {
        setNotes((current) => mergeNotesBySeq(current, scoped, "append"));
        if (typeof response.totalCount === "number") setTotalCount(response.totalCount);
        if (typeof response.laneCount === "number") setLaneCount(response.laneCount);
      } else {
        setNotes(scoped);
        setHasOlder(response.hasOlder === true);
        applyCounts(response, rawShared);
      }
      setError(null);
    } catch (loadError) {
      if (scopeRequestId === requestIdRef.current) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    }
  }, [api, applyCounts, filter, laneId, swarmTaskId]);

  const loadOlder = useCallback(async () => {
    const beforeSeq = oldestSeqRef.current;
    if (!hasOlder || isLoadingOlder || !beforeSeq) return;
    const scopeRequestId = requestIdRef.current;
    setIsLoadingOlder(true);
    try {
      const response = await api.get<SwarmNotesResponse>(
        buildSwarmNotesUrl({ swarmTaskId, laneId, filter, beforeSeq })
      );
      if (scopeRequestId !== requestIdRef.current) return;
      const rawShared = response.notes.filter((note) => note.kind === "shared");
      setNotes((current) => mergeNotesBySeq(current, filterScopeNotes(rawShared, filter, laneId), "prepend"));
      setHasOlder(response.hasOlder === true);
      if (typeof response.totalCount === "number") setTotalCount(response.totalCount);
      if (typeof response.laneCount === "number") setLaneCount(response.laneCount);
      setError(null);
    } catch (loadError) {
      if (scopeRequestId === requestIdRef.current) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (scopeRequestId === requestIdRef.current) setIsLoadingOlder(false);
    }
  }, [api, filter, hasOlder, isLoadingOlder, laneId, swarmTaskId]);

  useEffect(() => {
    setNotes([]);
    setHasOlder(false);
    setIsLoading(true);
    setIsLoadingOlder(false);
    void loadLatestPage();
  }, [loadLatestPage]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => void pollNewer(), SHARED_NOTES_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [active, pollNewer]);

  return { notes, hasOlder, totalCount, laneCount, isLoading, isLoadingOlder, error, loadOlder };
}
