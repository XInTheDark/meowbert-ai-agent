import { ChevronLeft, X } from "lucide-react";
import type { ApiClient } from "../../../lib/api";
import type { TaskWorkflowOverview } from "../../../lib/types";
import { formatDateTime, formatTaskTypeLabel } from "../../../lib/utils";
import type { TaskDetailWorkflowSidebarController } from "./useTaskDetailWorkflowSidebar";
import type { TaskWorkflowSidebarPanel } from "./taskWorkflowSidebarTypes";
import { TaskWorkflowOverviewPanel } from "./TaskWorkflowOverviewPanel";
import { TaskWorkflowWorkerPanel } from "./TaskWorkflowWorkerPanel";
import { TaskWorkflowChannelPanel } from "./TaskWorkflowChannelPanel";
import { TaskWorkflowTextPanel } from "./TaskWorkflowTextPanel";

interface TaskWorkflowSidebarProps {
  api: ApiClient;
  taskId: string;
  workflow: TaskWorkflowOverview;
  sidebar: TaskDetailWorkflowSidebarController;
}

function getWorkflowTitle(workflow: TaskWorkflowOverview): string {
  if (workflow.type === "long_horizon") {
    if (workflow.config.reviewMode === "quality_control") return "Quality Control";
    if (workflow.config.researchMode === "deep_research") return "Deep Research";
    return "Long Horizon";
  }
  return "Agent Swarm";
}

function resolvePanelHeaderInfo(panel: TaskWorkflowSidebarPanel | null, workflow: TaskWorkflowOverview) {
  if (!panel || panel.kind === "overview") {
    return {
      title: getWorkflowTitle(workflow),
      subtitle: "Workflow Overview"
    };
  }
  if (panel.kind === "worker") {
    return {
      title: panel.title || `Worker ${panel.slotIndex + 1}`,
      subtitle: `Worker ${panel.slotIndex + 1}`
    };
  }
  if (panel.kind === "channel") {
    return {
      title: panel.title || `${formatTaskTypeLabel(panel.channelKind)} channel`,
      subtitle: `${formatTaskTypeLabel(panel.channelKind)} · ${panel.memberCount} members`
    };
  }
  if (panel.kind === "plan") {
    const plan = workflow.type === "long_horizon" ? workflow.longHorizon.plan : null;
    return {
      title: "Plan",
      subtitle: plan?.createdAt ? `Saved ${formatDateTime(plan.createdAt)}` : "PLAN.md"
    };
  }
  if (panel.kind === "submission") {
    const latestRound = workflow.type === "long_horizon" ? workflow.longHorizon.latestRound : 0;
    return {
      title: "Latest Submission",
      subtitle: latestRound > 0 ? `Round ${latestRound}` : null
    };
  }
  if (panel.kind === "reviewer") {
    return {
      title: panel.title || `Reviewer ${panel.slotIndex + 1}`,
      subtitle: `Reviewer ${panel.slotIndex + 1}`
    };
  }
  return {
    title: `Reviewer ${typeof panel.reviewerSlot === "number" ? panel.reviewerSlot + 1 : "?"}`,
    subtitle: `${panel.approved ? "Approved" : "Changes requested"} · ${formatDateTime(panel.createdAt)}`
  };
}

function WorkflowSidebarHeader(props: {
  panel: TaskWorkflowSidebarPanel | null;
  workflow: TaskWorkflowOverview;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
}) {
  const { title, subtitle } = resolvePanelHeaderInfo(props.panel, props.workflow);

  return (
    <div className="thread-sidebar-header">
      <div className="thread-sidebar-header-main">
        {props.canGoBack ? (
          <button
            type="button"
            className="thread-sidebar-header-btn"
            onClick={props.onBack}
            title="Back to overview"
            aria-label="Back to overview"
          >
            <ChevronLeft size={16} />
          </button>
        ) : null}
        <div className="thread-sidebar-header-text">
          <div className="thread-sidebar-title-row">
            <strong>{title}</strong>
          </div>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      </div>
      <div className="thread-sidebar-header-actions">
        <button
          type="button"
          className="thread-sidebar-header-btn"
          onClick={props.onClose}
          title="Close sidebar"
          aria-label="Close sidebar"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function WorkflowPanelContent(props: {
  api: ApiClient;
  taskId: string;
  workflow: TaskWorkflowOverview;
  sidebar: TaskDetailWorkflowSidebarController;
  panel: TaskWorkflowSidebarPanel;
}) {
  const panel = props.panel;
  if (panel.kind === "overview") {
    return <TaskWorkflowOverviewPanel workflow={props.workflow} sidebar={props.sidebar} />;
  }
  if (panel.kind === "worker") {
    return (
      <TaskWorkflowWorkerPanel
        api={props.api}
        workerTaskId={panel.workerTaskId}
        slotIndex={panel.slotIndex}
        workerTitle={panel.title}
        status={panel.status}
      />
    );
  }
  if (panel.kind === "channel") {
    return (
      <TaskWorkflowChannelPanel
        api={props.api}
        taskId={props.taskId}
        channelId={panel.channelId}
        channelTitle={panel.title}
        channelKind={panel.channelKind}
        memberCount={panel.memberCount}
      />
    );
  }
  if (panel.kind === "plan") {
    return (
      <TaskWorkflowTextPanel
        content={props.workflow.type === "long_horizon" ? props.workflow.longHorizon.plan.content : null}
        emptyLabel="PLAN.md will appear once the agent starts execution."
      />
    );
  }
  if (panel.kind === "submission") {
    return (
      <TaskWorkflowTextPanel
        content={props.workflow.type === "long_horizon" ? props.workflow.longHorizon.latestSubmissionMessage : null}
        emptyLabel="No review submission yet."
      />
    );
  }
  if (panel.kind === "reviewer") {
    return (
      <TaskWorkflowWorkerPanel
        api={props.api}
        workerTaskId={panel.reviewerTaskId}
        slotIndex={panel.slotIndex}
        workerTitle={panel.title}
        status={panel.status}
      />
    );
  }
  return (
    <TaskWorkflowTextPanel
      content={panel.review}
      emptyLabel="No review notes."
      badgeLabel={panel.approved ? "approved" : "changes requested"}
      badgeTone={panel.approved ? "succeeded" : "failed"}
    />
  );
}

export function TaskWorkflowSidebar(props: TaskWorkflowSidebarProps) {
  const activePanel = props.sidebar.activePanel;
  if (!activePanel) return null;

  return (
    <aside className="thread-sidebar workflow-sidebar" aria-label="Workflow sidebar">
      <WorkflowSidebarHeader
        panel={activePanel}
        workflow={props.workflow}
        canGoBack={props.sidebar.workflowSidebarStack.length > 1}
        onBack={props.sidebar.popPanel}
        onClose={props.sidebar.closeSidebar}
      />
      <div className="thread-sidebar-body workflow-sidebar-body">
        <WorkflowPanelContent
          api={props.api}
          taskId={props.taskId}
          workflow={props.workflow}
          sidebar={props.sidebar}
          panel={activePanel}
        />
      </div>
    </aside>
  );
}
