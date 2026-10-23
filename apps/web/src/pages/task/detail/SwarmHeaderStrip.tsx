import { useState } from "react";
import { Users } from "lucide-react";
import type { AgentSwarmView } from "@meowbert/shared/agent-swarm-view";
import { ACTIVE_SWARM_LANE_STATUSES, listDormantSwarmLanes } from "./swarmLaneGroups";

interface SwarmHeaderStripProps {
  view: AgentSwarmView;
  rootTaskId: string;
  onOpenLane: (laneId: string) => void;
}

function firstLine(text: string | null): string {
  return (text ?? "").trim().split("\n")[0] ?? "";
}

// The swarm at a glance in the task header: lanes still working, and the dormant ones the leader can
// resume, listed with a one-line summary each.
export function SwarmHeaderStrip(props: SwarmHeaderStripProps) {
  const [isDormantOpen, setIsDormantOpen] = useState(false);
  const active = props.view.lanes.filter((lane) => ACTIVE_SWARM_LANE_STATUSES.has(lane.status)).length;
  const dormant = listDormantSwarmLanes(props.view.lanes, props.rootTaskId);
  if (props.view.lanes.length === 0) return null;
  return (
    <div className="task-workflow-strip" role="region" aria-label="Agent Swarm">
      <span className="task-workflow-strip-main">
        <span className="task-workflow-strip-tag"><Users size={14} aria-hidden="true" /><span>Agent Swarm</span></span>
      </span>
      <div className="task-workflow-strip-metrics">
        <span className="task-workflow-strip-chip"><span>Working</span><strong>{active}</strong></span>
        {props.view.budgetsEnabled && props.view.tokenBudget ? (
          <span className="task-workflow-strip-chip">
            <span>Budget</span><strong>{Math.round((props.view.spentTokens / props.view.tokenBudget) * 100)}%</strong>
          </span>
        ) : null}
        {dormant.length > 0 ? (
          <span className="swarm-dormant-menu">
            <button type="button" className="task-workflow-strip-chip" aria-expanded={isDormantOpen}
              onClick={() => setIsDormantOpen((current) => !current)} title="Lanes the leader can resume">
              <span>Dormant</span><strong>{dormant.length}</strong>
            </button>
            {isDormantOpen ? (
              <ul className="swarm-dormant-list" role="menu">
                {dormant.map((lane) => (
                  <li key={lane.id}>
                    <button type="button" role="menuitem" onClick={() => {
                      setIsDormantOpen(false);
                      props.onOpenLane(lane.id);
                    }}>
                      <strong>{lane.title}</strong>
                      <span>{firstLine(lane.summary)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}
