import { useMemo } from "react";
import { PanelRightOpen, Users, GitFork, Compass } from "lucide-react";
import type {
  LongHorizonWorkflowOverview,
  AgentSwarmWorkflowOverview,
  TaskWorkflowOverview
} from "../../../lib/types";
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

function AgentSwarmMetrics(props: {
  workflow: AgentSwarmWorkflowOverview;
  sidebar: TaskDetailWorkflowSidebarController;
}) {
  const activeWorkerCount = useMemo(
    () => props.workflow.agentSwarm.workers.filter((worker) => (
      !worker.paused && (worker.status === "running" || worker.status === "starting" || worker.status === "queued")
    )).length,
    [props.workflow.agentSwarm.workers]
  );
  const workerTotal = props.workflow.agentSwarm.workerCount;
  const channelTotal = props.workflow.agentSwarm.channels.length;

  return (
    <div className="task-workflow-strip-metrics">
      <button
        type="button"
        className={`task-workflow-strip-chip${activeWorkerCount > 0 ? " active" : ""}`}
        onClick={props.sidebar.openOverview}
        title="View swarm workers"
      >
        <span>Workers</span>
        <strong>{`${activeWorkerCount}/${workerTotal} active`}</strong>
      </button>
      <button
        type="button"
        className="task-workflow-strip-chip"
        onClick={props.sidebar.openOverview}
        title="View swarm channels"
      >
        <span>Channels</span>
        <strong>{channelTotal}</strong>
      </button>
    </div>
  );
}

function getWorkflowTitle(workflow: TaskWorkflowOverview): string {
  if (workflow.type === "long_horizon") {
    if (workflow.config.reviewMode === "quality_control") return "Quality Control";
    if (workflow.config.researchMode === "deep_research") return "Deep Research";
    return "Long Horizon";
  }
  return "Agent Swarm";
}

function WorkflowIcon({ workflow }: { workflow: TaskWorkflowOverview }) {
  if (workflow.type === "long_horizon") {
    if (workflow.config.researchMode === "deep_research") return <Compass size={14} aria-hidden="true" />;
    return <GitFork size={14} aria-hidden="true" />;
  }
  return <Users size={14} aria-hidden="true" />;
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

      {props.workflow.type === "long_horizon" ? (
        <LongHorizonMetrics workflow={props.workflow} sidebar={props.sidebar} />
      ) : (
        <AgentSwarmMetrics workflow={props.workflow} sidebar={props.sidebar} />
      )}

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
