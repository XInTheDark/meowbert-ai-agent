import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentSwarmView } from "@meowbert/shared/agent-swarm-view";
import type { ApiClient } from "../../../lib/api";
import type { LiveEvent } from "../../../lib/types";
import { ACTIVE_SWARM_LANE_STATUSES } from "./swarmLaneGroups";

const ACTIVE_POLL_INTERVAL_MS = 4_000;

function countSwarmEvents(events: LiveEvent[]): number {
  return events.filter((event) => event.type === "log" && event.payload.phase === "swarm_lane").length;
}

// The lane tree of an Agent Swarm task. It refetches when the task's event stream reports a lane
// change or note, and polls while lanes work, since automatic notes arrive between steps.
export function useTaskSwarmLanes(input: { api: ApiClient; taskId: string | null; enabled: boolean; events: LiveEvent[] }) {
  const { api, taskId, enabled } = input;
  const [view, setView] = useState<AgentSwarmView | null>(null);
  const [openLaneId, setOpenLaneId] = useState<string | null>(null);
  const [stopError, setStopError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!taskId || !enabled) {
      setView(null);
      return;
    }
    const requestId = ++requestIdRef.current;
    try {
      const response = await api.get<{ swarm: AgentSwarmView | null }>(`/api/tasks/${taskId}/swarm`);
      if (requestId === requestIdRef.current) setView(response.swarm);
    } catch {
      // A failed refresh keeps the last tree; the next event or poll tries again.
    }
  }, [api, enabled, taskId]);

  useEffect(() => {
    setOpenLaneId(null);
    void load();
  }, [load]);

  const swarmEventCount = countSwarmEvents(input.events);
  useEffect(() => {
    if (swarmEventCount > 0) void load();
  }, [load, swarmEventCount]);

  const hasActiveLanes = useMemo(() => view?.lanes.some((lane) => ACTIVE_SWARM_LANE_STATUSES.has(lane.status)) ?? false, [view]);
  useEffect(() => {
    if (!hasActiveLanes) return;
    const timer = window.setInterval(() => void load(), ACTIVE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasActiveLanes, load]);

  const stopLane = useCallback(async (laneId: string, discard: boolean) => {
    if (!taskId) return;
    setStopError(null);
    try {
      await api.post(`/api/tasks/${taskId}/swarm/lanes/${laneId}/stop`, { discard });
      await load();
    } catch (error) {
      setStopError(error instanceof Error ? error.message : String(error));
    }
  }, [api, load, taskId]);

  const openLane = view?.lanes.find((lane) => lane.id === openLaneId) ?? null;
  return { view, hasActiveLanes, openLane, setOpenLaneId, stopLane, stopError };
}

export type TaskSwarmLanesController = ReturnType<typeof useTaskSwarmLanes>;
