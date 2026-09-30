import { ChevronRight, FileText, Send, CheckCircle2, XCircle, Clock3 } from "lucide-react";
import type {
  LongHorizonWorkflowOverview,
  AgentSwarmWorkflowOverview,
  TaskWorkflowOverview
} from "../../../lib/types";
import { badgeClass, formatDateTime, formatRelative, formatTaskTypeLabel } from "../../../lib/utils";
import type { TaskDetailWorkflowSidebarController } from "./useTaskDetailWorkflowSidebar";
import { formatSwarmAgentLabel } from "./swarmAgentLabel";

function WorkerCard(props: {
  worker: AgentSwarmWorkflowOverview["agentSwarm"]["workers"][number];
  onSelect: () => void;
}) {
  const worker = props.worker;
  return (
    <button
      type="button"
      className="workflow-sidebar-card workflow-worker-item"
      onClick={props.onSelect}
    >
      <div className="workflow-sidebar-card-main">
        <div className="workflow-sidebar-card-header">
          <span className="workflow-sidebar-card-slot">{formatSwarmAgentLabel(worker)}</span>
          <span className={`${badgeClass(worker.paused ? "paused" : worker.status)} workflow-chip-status`}>
            {worker.paused ? "paused" : worker.status}
          </span>
        </div>
        <div className="workflow-sidebar-card-title">
          {worker.title || formatSwarmAgentLabel(worker)}
        </div>
        <div className="workflow-sidebar-card-footer muted-text">
          <span>Updated {formatRelative(worker.updated_at)}</span>
        </div>
      </div>
      <ChevronRight size={15} className="workflow-sidebar-card-chevron" aria-hidden="true" />
    </button>
  );
}

function ChannelCard(props: {
  channel: AgentSwarmWorkflowOverview["agentSwarm"]["channels"][number];
  onSelect: () => void;
}) {
  const channel = props.channel;
  return (
    <button
      type="button"
      className="workflow-sidebar-card workflow-channel-item"
      onClick={props.onSelect}
    >
      <div className="workflow-sidebar-card-main">
        <div className="workflow-sidebar-card-header">
          <span className="workflow-sidebar-card-slot">{formatTaskTypeLabel(channel.kind)}</span>
          <span className="badge muted">#{channel.latest_message_no ?? 0}</span>
        </div>
        <div className="workflow-sidebar-card-title">
          {channel.title || `${formatTaskTypeLabel(channel.kind)} channel`}
        </div>
        <div className="workflow-sidebar-card-footer muted-text">
          <span>{channel.member_task_ids.length} members</span>
        </div>
      </div>
      <ChevronRight size={15} className="workflow-sidebar-card-chevron" aria-hidden="true" />
    </button>
  );
}

function ReviewCard(props: {
  review: LongHorizonWorkflowOverview["longHorizon"]["reviews"][number];
  onSelect: () => void;
}) {
  const review = props.review;
  return (
    <button
      type="button"
      className="workflow-sidebar-card"
      onClick={props.onSelect}
    >
      <div className="workflow-sidebar-card-icon">
        {review.approved ? <CheckCircle2 size={16} className="text-success" /> : <XCircle size={16} className="text-warning" />}
      </div>
      <div className="workflow-sidebar-card-main">
        <div className="workflow-sidebar-card-header">
          <span className="workflow-sidebar-card-slot">
            Reviewer {typeof review.reviewer_slot_index === "number" ? review.reviewer_slot_index + 1 : "?"}
          </span>
          <span className={`${badgeClass(review.approved ? "succeeded" : "failed")} task-recurring-pill`}>
            {review.approved ? "approved" : "changes requested"}
          </span>
        </div>
        <div className="workflow-sidebar-card-preview muted-text">
          {review.review ? review.review.slice(0, 80) : "No review notes."}
        </div>
      </div>
      <ChevronRight size={15} className="workflow-sidebar-card-chevron" aria-hidden="true" />
    </button>
  );
}

function reviewerStatusLabel(status: string, latestRound: number): string {
  const normalizedStatus = status.trim().toLowerCase();
  if (["queued", "starting", "running", "awaiting_input", "interrupting"].includes(normalizedStatus)) {
    return "in progress";
  }
  if (latestRound > 0 && normalizedStatus === "succeeded") {
    return "awaiting verdict";
  }
  return normalizedStatus || "not started";
}

function ReviewerStatusCard(props: {
  reviewer: LongHorizonWorkflowOverview["longHorizon"]["reviewers"][number];
  latestRound: number;
  onSelect: () => void;
}) {
  const status = props.reviewer.status.trim().toLowerCase();
  const isActive = ["queued", "starting", "running", "awaiting_input", "interrupting"].includes(status);
  return (
    <button
      type="button"
      className="workflow-sidebar-card"
      onClick={props.onSelect}
    >
      <div className="workflow-sidebar-card-icon">
        <Clock3 size={16} className={isActive ? "text-warning" : "muted-text"} />
      </div>
      <div className="workflow-sidebar-card-main">
        <div className="workflow-sidebar-card-header">
          <span className="workflow-sidebar-card-slot">Reviewer {props.reviewer.slot_index + 1}</span>
          <span className={`${badgeClass(isActive ? "running" : status)} task-recurring-pill`}>
            {reviewerStatusLabel(status, props.latestRound)}
          </span>
        </div>
        <div className="workflow-sidebar-card-title">
          {props.reviewer.title || `Reviewer ${props.reviewer.slot_index + 1}`}
        </div>
        <div className="workflow-sidebar-card-preview muted-text">
          {props.latestRound > 0 ? `Reviewing round ${props.latestRound}` : "Waiting for a submission."}
        </div>
      </div>
      <ChevronRight size={15} className="workflow-sidebar-card-chevron" aria-hidden="true" />
    </button>
  );
}

function AgentSwarmOverview(props: {
  workflow: AgentSwarmWorkflowOverview;
  sidebar: TaskDetailWorkflowSidebarController;
}) {
  const { workers, channels } = props.workflow.agentSwarm;
  return (
    <div className="workflow-sidebar-body-inner">
      <section className="workflow-sidebar-section">
        <div className="workflow-sidebar-section-heading">
          <h4>Workers ({workers.length})</h4>
        </div>
        <div className="workflow-sidebar-cards-list">
          {workers.map((worker) => (
            <WorkerCard
              key={worker.task_id}
              worker={worker}
              onSelect={() => props.sidebar.openWorker(worker)}
            />
          ))}
        </div>
      </section>

      <section className="workflow-sidebar-section">
        <div className="workflow-sidebar-section-heading">
          <h4>Channels ({channels.length})</h4>
        </div>
        <div className="workflow-sidebar-cards-list">
          {channels.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              onSelect={() => props.sidebar.openChannel(channel)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function LongHorizonOverview(props: {
  workflow: LongHorizonWorkflowOverview;
  sidebar: TaskDetailWorkflowSidebarController;
}) {
  const { plan, latestSubmissionMessage, latestRound, reviews } = props.workflow.longHorizon;
  const currentRoundReviews = reviews.filter((r) => r.round_no === latestRound);
  const reviewers = props.workflow.longHorizon.reviewers ?? [];
  const matchedReviewIds = new Set<string>();
  const reviewerCards = reviewers.map((reviewer) => {
    const review = currentRoundReviews.find((candidate) => (
      candidate.reviewer_task_id === reviewer.task_id
      || candidate.reviewer_slot_index === reviewer.slot_index
    ));
    if (review) matchedReviewIds.add(review.id);
    return { reviewer, review };
  });
  const unmatchedReviews = currentRoundReviews.filter((review) => !matchedReviewIds.has(review.id));

  return (
    <div className="workflow-sidebar-body-inner">
      <section className="workflow-sidebar-section">
        <div className="workflow-sidebar-section-heading">
          <h4>Artifacts & Submission</h4>
        </div>
        <div className="workflow-sidebar-cards-list">
          <button
            type="button"
            className="workflow-sidebar-card"
            onClick={props.sidebar.openPlan}
          >
            <div className="workflow-sidebar-card-icon"><FileText size={16} /></div>
            <div className="workflow-sidebar-card-main">
              <div className="workflow-sidebar-card-title">Execution Plan</div>
              <div className="workflow-sidebar-card-footer muted-text">
                {plan.createdAt ? `Saved ${formatDateTime(plan.createdAt)}` : "PLAN.md"}
              </div>
            </div>
            <ChevronRight size={15} className="workflow-sidebar-card-chevron" aria-hidden="true" />
          </button>

          <button
            type="button"
            className="workflow-sidebar-card"
            onClick={props.sidebar.openSubmission}
          >
            <div className="workflow-sidebar-card-icon"><Send size={16} /></div>
            <div className="workflow-sidebar-card-main">
              <div className="workflow-sidebar-card-title">Latest Submission</div>
              <div className="workflow-sidebar-card-footer muted-text">
                {latestRound > 0 ? `Round ${latestRound}` : "Not submitted"}
              </div>
            </div>
            <ChevronRight size={15} className="workflow-sidebar-card-chevron" aria-hidden="true" />
          </button>
        </div>
      </section>

      <section className="workflow-sidebar-section">
        <div className="workflow-sidebar-section-heading">
          <h4>Reviewer Verdicts ({currentRoundReviews.length})</h4>
        </div>
        {reviewerCards.length === 0 && unmatchedReviews.length === 0 ? (
          <div className="muted-text" style={{ padding: "0.5rem 0.2rem" }}>
            No reviewer verdicts yet for round {latestRound || 1}.
          </div>
        ) : (
          <div className="workflow-sidebar-cards-list">
            {reviewerCards.map(({ reviewer, review }) => review ? (
              <ReviewCard key={review.id} review={review} onSelect={() => props.sidebar.openReview(review)} />
            ) : (
              <ReviewerStatusCard
                key={reviewer.task_id}
                reviewer={reviewer}
                latestRound={latestRound}
                onSelect={() => props.sidebar.openReviewer(reviewer)}
              />
            ))}
            {unmatchedReviews.map((review) => (
              <ReviewCard key={review.id} review={review} onSelect={() => props.sidebar.openReview(review)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function TaskWorkflowOverviewPanel(props: {
  workflow: TaskWorkflowOverview;
  sidebar: TaskDetailWorkflowSidebarController;
}) {
  if (props.workflow.type === "long_horizon") {
    return <LongHorizonOverview workflow={props.workflow} sidebar={props.sidebar} />;
  }
  return <AgentSwarmOverview workflow={props.workflow} sidebar={props.sidebar} />;
}
