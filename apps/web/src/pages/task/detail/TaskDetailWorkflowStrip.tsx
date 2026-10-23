import { useMemo } from "react";
import { PanelRightOpen, GitFork, Compass } from "lucide-react";
import type { LongHorizonWorkflowOverview, TaskWorkflowOverview } from "../../../lib/types";
import { badgeClass } from "../../../lib/utils";
import type { TaskDetailWorkflowSidebarController } from "./useTaskDetailWorkflowSidebar";

interface TaskDetailWorkflowStripProps {
  workflow: TaskWorkflowOverview;
  sidebar: TaskDetailWorkflowSidebarController;
}

function LongHorizonMetrics(props: {
  workflow: LongHorizonWorkflowOverview;
  sidebar: TaskDetailWorkflowSidebarController;
}) {
  const latestRoundReviews = useMemo(
    () => props.workflow.longHorizon.reviews.filter((r) => r.round_no === props.workflow.longHorizon.latestRound),
    [props.workflow.longHorizon.latestRound, props.workflow.longHorizon.reviews]
  );
  const approvedCount = latestRoundReviews.filter((r) => r.approved).length;

  return (
    <div className="task-workflow-strip-metrics">
      <button
        type="button"
        className="task-workflow-strip-chip"
        onClick={props.sidebar.openOverview}
        title="View workflow round"
      >
        <span>Round</span>
        <strong>{props.workflow.longHorizon.latestRound > 0 ? props.workflow.longHorizon.latestRound : "–"}</strong>
      </button>
      <button
        type="button"
        className="task-workflow-strip-chip"
        onClick={props.sidebar.openOverview}
        title="View reviewer verdicts"
      >
        <span>Reviews</span>
        <strong>
          {latestRoundReviews.length > 0 ? `${approvedCount}/${latestRoundReviews.length} approved` : "none"}
        </strong>
      </button>
    </div>
  );
}

function getWorkflowTitle(workflow: TaskWorkflowOverview): string {
  if (workflow.config.reviewMode === "quality_control") return "Quality Control";
  if (workflow.config.researchMode === "deep_research") return "Deep Research";
  return "Long Horizon";
}

function WorkflowIcon({ workflow }: { workflow: TaskWorkflowOverview }) {
  if (workflow.config.researchMode === "deep_research") return <Compass size={14} aria-hidden="true" />;
  return <GitFork size={14} aria-hidden="true" />;
}

export function TaskDetailWorkflowStrip(props: TaskDetailWorkflowStripProps) {
  const title = getWorkflowTitle(props.workflow);
  const phase = props.workflow.phase;
  const isSidebarOpen = props.sidebar.isWorkflowSidebarOpen;

  return (
    <div className={`task-workflow-strip${isSidebarOpen ? " sidebar-open" : ""}`} role="region" aria-label="Workflow Status">
      <button
        type="button"
        className="task-workflow-strip-main"
        onClick={props.sidebar.openOverview}
        title="Click to view workflow details"
      >
        <span className="task-workflow-strip-tag">
          <WorkflowIcon workflow={props.workflow} />
          <span>{title}</span>
        </span>
        <span className={`${badgeClass(phase === "completed" || phase === "approved" ? "succeeded" : phase === "failed" ? "failed" : "running")} task-workflow-phase-badge`}>
          {phase}
        </span>
      </button>

      <LongHorizonMetrics workflow={props.workflow} sidebar={props.sidebar} />

      <button
        type="button"
        className={`task-workflow-strip-action${isSidebarOpen ? " active" : ""}`}
        onClick={isSidebarOpen ? props.sidebar.closeSidebar : props.sidebar.openOverview}
        title={isSidebarOpen ? "Close workflow sidebar" : "Open workflow sidebar"}
        aria-label={isSidebarOpen ? "Close workflow sidebar" : "Open workflow sidebar"}
      >
        <PanelRightOpen size={14} aria-hidden="true" />
        <span className="task-workflow-strip-action-label">{isSidebarOpen ? "Hide" : "Details"}</span>
      </button>
    </div>
  );
}
