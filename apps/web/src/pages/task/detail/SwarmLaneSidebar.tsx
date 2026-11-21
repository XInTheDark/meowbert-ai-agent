import { useEffect, useState } from "react";
import { Info, MessageSquare, MessageSquareShare, X } from "lucide-react";
import type { AgentSwarmLaneView } from "@meowbert/shared/agent-swarm-view";
import type { ApiClient } from "../../../lib/api";
import type { TaskDetail } from "../../../lib/types";
import { ACTIVE_SWARM_LANE_STATUSES } from "./swarmLaneGroups";
import { SwarmLaneDetailsPanel } from "./SwarmLaneDetailsPanel";
import { SwarmSharedNotesPanel } from "./SwarmSharedNotesPanel";
import { TaskWorkflowWorkerPanel } from "./TaskWorkflowWorkerPanel";
import { useSwarmSharedNotes, type SwarmNotesFilter } from "./useSwarmSharedNotes";

interface SwarmLaneSidebarProps {
  api: ApiClient;
  swarmTaskId: string;
  lane: AgentSwarmLaneView;
  onClose: () => void;
}

type LaneSidebarTab = "chat" | "notes" | "details";

const LANE_KIND_LABELS: Record<AgentSwarmLaneView["kind"], string> = {
  split: "Split lane",
  diverge: "Diverge lane",
  check: "Check lane"
};

// Lanes are tasks, so a lane opens with its conversation, shared notes timeline, and lane details.
export function SwarmLaneSidebar(props: SwarmLaneSidebarProps) {
  const { lane } = props;
  const [activeTab, setActiveTab] = useState<LaneSidebarTab>("chat");
  const [notesFilter, setNotesFilter] = useState<SwarmNotesFilter>("lane");
  const [laneTaskDetail, setLaneTaskDetail] = useState<TaskDetail | null>(null);
  const sharedNotes = useSwarmSharedNotes({
    api: props.api,
    swarmTaskId: props.swarmTaskId,
    laneId: lane.id,
    filter: notesFilter,
    active: ACTIVE_SWARM_LANE_STATUSES.has(lane.status)
  });

  useEffect(() => {
    setLaneTaskDetail(null);
  }, [lane.id]);

  const notesBadgeCount = sharedNotes.laneCount > 0 ? sharedNotes.laneCount : sharedNotes.totalCount;

  return (
    <aside className="thread-sidebar workflow-sidebar" aria-label="Lane">
      <div className="thread-sidebar-header">
        <div className="thread-sidebar-header-main">
          <div className="thread-sidebar-header-text">
            <div className="thread-sidebar-title-row"><strong>{lane.title}</strong></div>
            <span>{[LANE_KIND_LABELS[lane.kind], lane.kind === "check" ? `${lane.reviewEffort === "thorough" ? "Thorough" : "Standard"} review` : null,
              lane.model].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
        <div className="thread-sidebar-header-actions">
          <button type="button" className="thread-sidebar-header-btn" onClick={props.onClose} title="Close lane" aria-label="Close lane">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="swarm-lane-tabs" role="tablist" aria-label="Lane views">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "chat"}
          className={`swarm-lane-tab ${activeTab === "chat" ? "active" : ""}`}
          onClick={() => setActiveTab("chat")}
        >
          <MessageSquare size={13} aria-hidden="true" />
          <span>Chat</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "notes"}
          className={`swarm-lane-tab ${activeTab === "notes" ? "active" : ""}`}
          onClick={() => setActiveTab("notes")}
        >
          <MessageSquareShare size={13} aria-hidden="true" />
          <span>Shared notes</span>
          {notesBadgeCount > 0 ? <span className="swarm-lane-tab-count">{notesBadgeCount}</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "details"}
          className={`swarm-lane-tab ${activeTab === "details" ? "active" : ""}`}
          onClick={() => setActiveTab("details")}
        >
          <Info size={13} aria-hidden="true" />
          <span>Details</span>
        </button>
      </div>

      <div className="thread-sidebar-body workflow-sidebar-body">
        <div className={`swarm-lane-tab-pane ${activeTab === "chat" ? "" : "is-hidden"}`}>
          <TaskWorkflowWorkerPanel
            key={lane.id}
            api={props.api}
            workerTaskId={lane.id}
            slotIndex={0}
            workerTitle={lane.title}
            status={lane.status}
            onTaskDetailChange={setLaneTaskDetail}
          />
        </div>
        {activeTab === "notes" ? (
          <SwarmSharedNotesPanel
            laneId={lane.id}
            filter={notesFilter}
            onFilterChange={setNotesFilter}
            notes={sharedNotes.notes}
            laneCount={sharedNotes.laneCount}
            totalCount={sharedNotes.totalCount}
            hasOlder={sharedNotes.hasOlder}
            isLoading={sharedNotes.isLoading}
            isLoadingOlder={sharedNotes.isLoadingOlder}
            onLoadOlder={() => void sharedNotes.loadOlder()}
            error={sharedNotes.error}
          />
        ) : null}
        {activeTab === "details" ? (
          <SwarmLaneDetailsPanel lane={lane} taskDetail={laneTaskDetail} />
        ) : null}
      </div>
    </aside>
  );
}
