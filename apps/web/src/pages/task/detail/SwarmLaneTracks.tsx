import { PanelRightOpen, Square } from "lucide-react";
import type { AgentSwarmLaneView } from "@meowbert/shared/agent-swarm-view";
import { badgeClass } from "../../../lib/utils";
import { formatTokenCount } from "../../../components/taskConversation/shared";
import { ACTIVE_SWARM_LANE_STATUSES, type SwarmLaneGroup, type SwarmLaneNode } from "./swarmLaneGroups";

interface SwarmLaneTracksProps {
  group: SwarmLaneGroup;
  budgetsEnabled: boolean;
  onOpenLane: (laneId: string) => void;
  onStopLane: (laneId: string) => void;
}

const LANE_KIND_LABELS: Record<AgentSwarmLaneView["kind"], string> = { split: "Split", diverge: "Diverge", check: "Check" };

function laneBadgeStatus(status: AgentSwarmLaneView["status"]): string {
  if (status === "done") return "succeeded";
  if (status === "waiting") return "running";
  return status;
}

function LaneRow(props: Omit<SwarmLaneTracksProps, "group"> & { node: SwarmLaneNode }) {
  const { lane } = props.node;
  const active = ACTIVE_SWARM_LANE_STATUSES.has(lane.status);
  const detail = lane.kind === "check" && lane.status === "done"
    ? `${lane.checkFindings} finding${lane.checkFindings === 1 ? "" : "s"}`
    : lane.latestNote ?? (lane.status === "done" ? lane.summary : null);
  return (
    <li className="swarm-lane-row">
      <div className="swarm-lane-row-main">
        <span className="swarm-lane-kind">{LANE_KIND_LABELS[lane.kind]}</span>
        <span className="swarm-lane-title" title={lane.direction ?? lane.title}>{lane.title}</span>
        <span className={badgeClass(laneBadgeStatus(lane.status))}>{lane.status}</span>
        <span className="swarm-lane-meta">
          {lane.steps} steps{props.budgetsEnabled ? ` · ${formatTokenCount(lane.spentTokens)} tokens` : ""}
        </span>
        <span className="swarm-lane-actions">
          <button type="button" className="icon-btn-subtle" title="Open lane" aria-label={`Open lane ${lane.title}`}
            onClick={() => props.onOpenLane(lane.id)}>
            <PanelRightOpen size={14} />
          </button>
          {active ? (
            <button type="button" className="icon-btn-subtle" title="Stop: submit what it has"
              aria-label={`Stop lane ${lane.title}`} onClick={() => props.onStopLane(lane.id)}>
              <Square size={13} />
            </button>
          ) : null}
        </span>
      </div>
      {detail ? <div className="swarm-lane-detail">{detail}</div> : null}
      {props.node.children.length > 0 ? (
        <ul className="swarm-lane-children">
          {props.node.children.map((child) => <LaneRow key={child.lane.id} {...props} node={child} />)}
        </ul>
      ) : null}
    </li>
  );
}

// One row per lane under the leader message that started them; sub-lanes nest under their lane.
export function SwarmLaneTracks(props: SwarmLaneTracksProps) {
  return (
    <div className="swarm-lane-tracks">
      <ul className="swarm-lane-list">
        {props.group.nodes.map((node) => (
          <LaneRow key={node.lane.id} node={node} budgetsEnabled={props.budgetsEnabled}
            onOpenLane={props.onOpenLane} onStopLane={props.onStopLane} />
        ))}
      </ul>
    </div>
  );
}
