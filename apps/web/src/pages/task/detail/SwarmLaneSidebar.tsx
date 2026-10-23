import { X } from "lucide-react";
import type { AgentSwarmLaneView } from "@meowbert/shared/agent-swarm-view";
import type { ApiClient } from "../../../lib/api";
import { TaskWorkflowWorkerPanel } from "./TaskWorkflowWorkerPanel";

interface SwarmLaneSidebarProps {
  api: ApiClient;
  lane: AgentSwarmLaneView;
  onClose: () => void;
}

const LANE_KIND_LABELS: Record<AgentSwarmLaneView["kind"], string> = { split: "Split lane", diverge: "Diverge lane", check: "Check lane" };

// Lanes are tasks, so a lane opens with the normal conversation view of its own task.
export function SwarmLaneSidebar(props: SwarmLaneSidebarProps) {
  const { lane } = props;
  return (
    <aside className="thread-sidebar workflow-sidebar" aria-label="Lane">
      <div className="thread-sidebar-header">
        <div className="thread-sidebar-header-main">
          <div className="thread-sidebar-header-text">
            <div className="thread-sidebar-title-row"><strong>{lane.title}</strong></div>
            <span>{[LANE_KIND_LABELS[lane.kind], lane.model].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
        <div className="thread-sidebar-header-actions">
          <button type="button" className="thread-sidebar-header-btn" onClick={props.onClose} title="Close lane" aria-label="Close lane">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="thread-sidebar-body workflow-sidebar-body">
        <TaskWorkflowWorkerPanel
          key={lane.id}
          api={props.api}
          workerTaskId={lane.id}
          slotIndex={0}
          workerTitle={lane.title}
          status={lane.status}
        />
      </div>
    </aside>
  );
}
