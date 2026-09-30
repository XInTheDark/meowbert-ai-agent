import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ApiClient } from "../../../lib/api";
import type { TaskWorkflowOverview, TaskWorkflowType } from "../../../lib/types";
import { badgeClass, formatDateTime, formatRelative, formatTaskTypeLabel } from "../../../lib/utils";
import {
  readTaskWorkflowPanelOpenPreference,
  writeTaskWorkflowPanelOpenPreference
} from "../../../task/taskWorkflowPanelPreferences";
import {
  SwarmChannelModal,
  SwarmWorkerPovModal,
  WorkflowTextModal
} from "./TaskDetailWorkflowModals";
import { formatSwarmAgentLabel } from "./swarmAgentLabel";

interface TaskDetailWorkflowPanelProps {
  api: ApiClient;
  taskId: string;
  workflow: TaskWorkflowOverview | null | undefined;
}

function normalizeWorkflowText(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function isExpandableWorkflowText(value: string): boolean {
  return value.length > 420 || value.split("\n").length > 8;
}

interface WorkflowMetric {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warning" | "danger";
}

function WorkflowPreviewCard(props: {
  label: string;
  value: string | null | undefined;
  emptyLabel: string;
  actionLabel: string;
  onOpen: () => void;
  footer?: string | null;
}): JSX.Element {
  const normalized = normalizeWorkflowText(props.value);
  const isExpandable = isExpandableWorkflowText(normalized);

  return (
    <section className="workflow-preview-card">
      <div className="workflow-section-label">{props.label}</div>
      {normalized.length > 0 ? (
        <div className="workflow-preview-text" aria-label={props.label}>
          {normalized}
        </div>
      ) : (
        <div className="muted-text">{props.emptyLabel}</div>
      )}
      <div className="workflow-preview-footer">
        <div className="muted-text">{props.footer ?? ""}</div>
        {normalized.length > 0 ? (
          <button type="button" className="btn ghost workflow-inline-action" onClick={props.onOpen}>
            {isExpandable ? props.actionLabel : `Open ${props.label.toLowerCase()}`}
          </button>
        ) : null}
      </div>
    </section>
  );
}

function WorkflowSection(props: {
  title: string;
  subtitle: string;
  metrics: WorkflowMetric[];
  defaultExpanded?: boolean;
  storagePreference?: {
    taskId: string;
    workflowType: TaskWorkflowType;
  };
  children: JSX.Element;
}): JSX.Element {
  const defaultExpanded = props.defaultExpanded === true;
  const storageTaskId = props.storagePreference?.taskId;
  const storageWorkflowType = props.storagePreference?.workflowType;
  const [isExpanded, setIsExpanded] = useState(() => (
    storageTaskId && storageWorkflowType
      ? readTaskWorkflowPanelOpenPreference({
          taskId: storageTaskId,
          workflowType: storageWorkflowType
        }, defaultExpanded)
      : defaultExpanded
  ));

  useEffect(() => {
    if (!storageTaskId || !storageWorkflowType) {
      setIsExpanded(defaultExpanded);
      return;
    }

    setIsExpanded(readTaskWorkflowPanelOpenPreference({
      taskId: storageTaskId,
      workflowType: storageWorkflowType
    }, defaultExpanded));
  }, [defaultExpanded, storageTaskId, storageWorkflowType]);

  function toggleExpanded(): void {
    setIsExpanded((current) => {
      const next = !current;
      if (storageTaskId && storageWorkflowType) {
        writeTaskWorkflowPanelOpenPreference({
          taskId: storageTaskId,
          workflowType: storageWorkflowType
        }, next);
      }
      return next;
    });
  }

  return (
    <section className="workflow-panel">
      <button
        type="button"
        className="workflow-panel-header"
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
      >
        <div className="workflow-panel-title-block">
          <span className="workflow-section-label">{props.subtitle}</span>
          <h3>{props.title}</h3>
        </div>
        <div className="workflow-panel-header-meta">
          {props.metrics.map((metric) => (
            <span
              key={`${metric.label}:${metric.value}`}
              className={`workflow-metric ${metric.tone ? `workflow-metric-${metric.tone}` : ""}`}
            >
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </span>
          ))}
          <span className="workflow-panel-chevron" aria-hidden="true">
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        </div>
      </button>
      {isExpanded ? <div className="workflow-panel-body">{props.children}</div> : null}
    </section>
  );
}

function LongHorizonPanel(props: {
  taskId: string;
  workflow: Extract<TaskWorkflowOverview, { type: "long_horizon" }>;
}): JSX.Element {
  const isQualityControl = props.workflow.config.reviewMode === "quality_control";
  const isDeepResearch = props.workflow.config.researchMode === "deep_research";
  const [modalView, setModalView] = useState<"plan" | "submission" | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const latestRoundReviews = useMemo(
    () => props.workflow.longHorizon.reviews.filter((review) => review.round_no === props.workflow.longHorizon.latestRound),
    [props.workflow.longHorizon.latestRound, props.workflow.longHorizon.reviews]
  );
  const approvedCount = latestRoundReviews.filter((review) => review.approved).length;
  const requestedChangesCount = latestRoundReviews.length - approvedCount;
  const selectedReview = latestRoundReviews.find((review) => review.id === selectedReviewId) ?? null;

  return (
    <>
      <WorkflowSection
        title={isQualityControl ? "Quality control" : isDeepResearch ? "Deep Research" : "Long Horizon"}
        subtitle="Workflow"
        metrics={[
          {
            label: "Phase",
            value: props.workflow.phase,
            tone: props.workflow.phase === "completed" || props.workflow.phase === "approved" ? "good" : "warning"
          },
          {
            label: "Round",
            value: props.workflow.longHorizon.latestRound > 0 ? String(props.workflow.longHorizon.latestRound) : "not started"
          },
          {
            label: "Reviews",
            value: latestRoundReviews.length > 0 ? String(latestRoundReviews.length) : "none"
          }
        ]}
        storagePreference={{
          taskId: props.taskId,
          workflowType: props.workflow.type
        }}
      >
        <div className="workflow-long-horizon-body">
          <div className="workflow-preview-grid">
            <WorkflowPreviewCard
              label="Plan"
              value={props.workflow.longHorizon.plan.content}
              emptyLabel="PLAN.md will appear once the clarify agent starts execution."
              actionLabel="Show plan"
              footer={
                props.workflow.longHorizon.plan.createdAt
                  ? `Saved ${formatDateTime(props.workflow.longHorizon.plan.createdAt)}`
                  : null
              }
              onOpen={() => setModalView("plan")}
            />
            <WorkflowPreviewCard
              label="Latest submission"
              value={props.workflow.longHorizon.latestSubmissionMessage}
              emptyLabel="No review submission yet."
              actionLabel="Show more"
              footer={
                props.workflow.longHorizon.latestRound > 0
                  ? `Current round ${props.workflow.longHorizon.latestRound}`
                  : null
              }
              onOpen={() => setModalView("submission")}
            />
          </div>

          <section className="workflow-review-section">
            <div className="workflow-review-section-header">
              <div className="workflow-section-label">Review panel</div>
              {latestRoundReviews.length > 0 ? (
                <div className="workflow-review-summary-chips">
                  <span className="badge good">{approvedCount} approved</span>
                  <span className="badge muted">{requestedChangesCount} requesting changes</span>
                </div>
              ) : null}
            </div>
            {latestRoundReviews.length === 0 ? (
              <div className="muted-text">No reviewer verdicts yet for the current round.</div>
            ) : (
              <div className="workflow-review-list">
                {latestRoundReviews.map((review) => (
                  <button
                    key={review.id}
                    type="button"
                    className="workflow-review-card workflow-review-card-button"
                    onClick={() => setSelectedReviewId(review.id)}
                  >
                    <div className="workflow-review-card-meta">
                      <div style={{ display: "flex", gap: "0.45rem", alignItems: "center", flexWrap: "wrap" }}>
                        <strong>Reviewer {typeof review.reviewer_slot_index === "number" ? review.reviewer_slot_index + 1 : "?"}</strong>
                        <span className={`${badgeClass(review.approved ? "succeeded" : "failed")} task-recurring-pill`}>
                          {review.approved ? "approved" : "changes requested"}
                        </span>
                      </div>
                      <span className="muted-text">{formatRelative(review.created_at)}</span>
                    </div>
                    <div className="workflow-review-text">{review.review || "No review notes."}</div>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </WorkflowSection>

      {modalView === "plan" ? (
        <WorkflowTextModal
          title="Plan"
          subtitle={props.workflow.longHorizon.plan.createdAt ? `Saved ${formatDateTime(props.workflow.longHorizon.plan.createdAt)}` : null}
          content={props.workflow.longHorizon.plan.content}
          emptyLabel="PLAN.md will appear once the clarify agent starts execution."
          onClose={() => setModalView(null)}
        />
      ) : null}
      {modalView === "submission" ? (
        <WorkflowTextModal
          title="Latest submission"
          subtitle={
            props.workflow.longHorizon.latestRound > 0
              ? `Round ${props.workflow.longHorizon.latestRound}`
              : null
          }
          content={props.workflow.longHorizon.latestSubmissionMessage}
          emptyLabel="No review submission yet."
          onClose={() => setModalView(null)}
        />
      ) : null}
      {selectedReview ? (
        <WorkflowTextModal
          title={`Reviewer ${typeof selectedReview.reviewer_slot_index === "number" ? selectedReview.reviewer_slot_index + 1 : "?"}`}
          subtitle={`${selectedReview.approved ? "Approved" : "Changes requested"} · ${formatDateTime(selectedReview.created_at)}`}
          content={selectedReview.review}
          emptyLabel="No review notes."
          onClose={() => setSelectedReviewId(null)}
        />
      ) : null}
    </>
  );
}

function AgentSwarmPanel(props: {
  api: ApiClient;
  taskId: string;
  workflow: Extract<TaskWorkflowOverview, { type: "agent_swarm" }>;
}): JSX.Element {
  const [openChannelId, setOpenChannelId] = useState<string | null>(null);
  const [openWorkerTaskId, setOpenWorkerTaskId] = useState<string | null>(null);
  const activeWorkerCount = useMemo(
    () => props.workflow.agentSwarm.workers.filter((worker) => (
      !worker.paused && (worker.status === "running" || worker.status === "starting" || worker.status === "queued")
    )).length,
    [props.workflow.agentSwarm.workers]
  );
  const swarmPhaseLabel = activeWorkerCount > 0 ? "active" : props.workflow.phase;
  const selectedChannel = props.workflow.agentSwarm.channels.find((channel) => channel.id === openChannelId) ?? null;
  const selectedWorker = props.workflow.agentSwarm.workers.find((worker) => worker.task_id === openWorkerTaskId) ?? null;

  return (
    <>
      <WorkflowSection
        title="Agent Swarm"
        subtitle="Workflow"
        metrics={[
          {
            label: "Phase",
            value: swarmPhaseLabel,
            tone: swarmPhaseLabel === "active"
              ? "warning"
              : props.workflow.phase === "completed"
                ? "good"
                : "neutral"
          },
          {
            label: "Workers",
            value: `${activeWorkerCount}/${props.workflow.agentSwarm.workerCount} active`,
            tone: activeWorkerCount > 0 ? "warning" : "neutral"
          },
          {
            label: "Channels",
            value: String(props.workflow.agentSwarm.channels.length)
          }
        ]}
        storagePreference={{
          taskId: props.taskId,
          workflowType: props.workflow.type
        }}
      >
        <div className="workflow-swarm-body">
          <section className="workflow-chip-group">
            <div className="workflow-chip-group-header">
              <div className="workflow-section-label">Workers</div>
            </div>
            <div className="workflow-worker-grid" role="list" aria-label="Swarm workers">
              {props.workflow.agentSwarm.workers.map((worker) => (
                <button
                  key={worker.task_id}
                  type="button"
                  className={`workflow-worker-card ${worker.task_id === openWorkerTaskId ? "active" : ""}`}
                  onClick={() => setOpenWorkerTaskId(worker.task_id)}
                >
                  <span className="workflow-worker-meta">{formatSwarmAgentLabel(worker)}</span>
                  <span className="workflow-worker-title">{worker.title || formatSwarmAgentLabel(worker)}</span>
                  <span className="workflow-worker-footer">
                    <span
                      className={`${badgeClass(worker.paused ? "paused" : worker.status)} workflow-chip-status`}
                      title={worker.paused ? worker.pause_reason ?? "Paused." : undefined}
                    >
                      {worker.paused ? "paused" : worker.status}
                    </span>
                    <span>{formatRelative(worker.updated_at)}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="workflow-chip-group">
            <div className="workflow-chip-group-header">
              <div className="workflow-section-label">Channels</div>
            </div>
            <div className="workflow-channel-grid" role="list" aria-label="Swarm channels">
              {props.workflow.agentSwarm.channels.map((channel) => (
                <button
                  key={channel.id}
                  type="button"
                  className={`workflow-channel-card ${channel.id === openChannelId ? "active" : ""}`}
                  onClick={() => setOpenChannelId(channel.id)}
                >
                  <span className="workflow-worker-meta">{formatTaskTypeLabel(channel.kind)}</span>
                  <span className="workflow-worker-title">{channel.title || formatTaskTypeLabel(channel.kind)}</span>
                  <span className="workflow-worker-footer">
                    <span>{channel.member_task_ids.length} members</span>
                    <span>#{channel.latest_message_no ?? 0}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </WorkflowSection>

      {selectedChannel ? (
        <SwarmChannelModal
          api={props.api}
          taskId={props.taskId}
          channel={selectedChannel}
          onClose={() => setOpenChannelId(null)}
        />
      ) : null}
      {selectedWorker ? (
        <SwarmWorkerPovModal
          api={props.api}
          worker={selectedWorker}
          onClose={() => setOpenWorkerTaskId(null)}
        />
      ) : null}
    </>
  );
}

export function TaskDetailWorkflowPanel(props: TaskDetailWorkflowPanelProps) {
  if (!props.workflow) {
    return null;
  }

  if (props.workflow.type === "long_horizon") {
    return <LongHorizonPanel taskId={props.taskId} workflow={props.workflow} />;
  }

  return <AgentSwarmPanel api={props.api} taskId={props.taskId} workflow={props.workflow} />;
}
