import { Users } from "lucide-react";
import type { AgentSwarmView } from "@meowbert/shared/agent-swarm-view";
import { ACTIVE_SWARM_LANE_STATUSES, listDormantSwarmLanes } from "./swarmLaneGroups";
import { SwarmLaneMenu } from "./SwarmLaneMenu";

interface SwarmHeaderStripProps {
  view: AgentSwarmView;
  rootTaskId: string;
  onOpenLane: (laneId: string) => void;
}

function firstLine(text: string | null): string {
  return (text ?? "").trim().split("\n")[0] ?? "";
}

// The swarm at a glance in the task header: the lanes still working and the dormant ones the leader
// can resume, each listed with a one-line summary.
export function SwarmHeaderStrip(props: SwarmHeaderStripProps) {
  if (props.view.lanes.length === 0) return null;
  const working = props.view.lanes
    .filter((lane) => ACTIVE_SWARM_LANE_STATUSES.has(lane.status))
    .map((lane) => ({ id: lane.id, title: lane.title, detail: firstLine(lane.latestNote) || lane.status }));
  const dormant = listDormantSwarmLanes(props.view.lanes, props.rootTaskId)
    .map((lane) => ({ id: lane.id, title: lane.title, detail: firstLine(lane.summary) }));
  return (
    <div className="task-workflow-strip" role="region" aria-label="Agent Swarm">
      <span className="task-workflow-strip-main">
        <span className="task-workflow-strip-tag"><Users size={14} aria-hidden="true" /><span>Agent Swarm</span></span>
      </span>
      <div className="task-workflow-strip-metrics">
        <SwarmLaneMenu label="Working" title="Lanes still working" items={working} onOpenLane={props.onOpenLane} />
        {props.view.budgetsEnabled && props.view.tokenBudget ? (
          <span className="task-workflow-strip-chip">
            <span>Budget</span><strong>{Math.round((props.view.spentTokens / props.view.tokenBudget) * 100)}%</strong>
          </span>
        ) : null}
        {dormant.length > 0 ? (
          <SwarmLaneMenu label="Dormant" title="Lanes the leader can resume" items={dormant} onOpenLane={props.onOpenLane} />
        ) : null}
      </div>
    </div>
  );
}
