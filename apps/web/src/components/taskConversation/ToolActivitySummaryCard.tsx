import { ChevronRight, LoaderCircle } from "lucide-react";
import type { TaskProgress } from "@meowbert/shared/task-progress";
import { ActivityArtifactChips } from "./ActivityArtifactChips";
import { ActivityProgressSteps } from "./ActivityProgressSteps";
import { ActivityStepTrail } from "./ActivityStepTrail";

export interface ToolActivitySummaryCardProps {
  kicker: string;
  title: string;
  count: number;
  preview?: string | null;
  secondaryLabel?: string | null;
  steps?: string[];
  progress?: TaskProgress | null;
  artifactPaths?: string[];
  badgeTone?: "default" | "running";
  running?: boolean;
  active?: boolean;
  showTitle?: boolean;
  onClick: () => void;
}

function formatCallCount(count: number): string {
  return `${count} call${count !== 1 ? "s" : ""}`;
}

function formatStepCount(progress: TaskProgress): string | null {
  const done = progress.steps.filter((step) => step.status === "done").length;
  return progress.steps.length > 0 ? `${done} of ${progress.steps.length} done` : null;
}

function GoalTitle(props: { goal: string; title: string; count: number; progress: TaskProgress; secondaryLabel?: string | null }): JSX.Element {
  const meta = [props.title, formatCallCount(props.count), formatStepCount(props.progress), props.secondaryLabel]
    .filter(Boolean).join(" · ");
  return (
    <span className="tool-activity-card-goal">
      <span className="tool-activity-card-goal-title">{props.goal}</span>
      <span className="tool-activity-card-goal-meta">{meta}</span>
    </span>
  );
}

function CountTitle(props: { title: string; count: number; running: boolean; secondaryLabel?: string | null }): JSX.Element {
  return (
    <div className="tool-activity-card-title-row">
      <span className="tool-activity-card-title">{props.title}</span>
      <span className={`tool-count-badge${props.running ? " running" : ""}`}>{formatCallCount(props.count)}</span>
      {props.secondaryLabel ? <span className="tool-activity-card-secondary-pill">{props.secondaryLabel}</span> : null}
    </div>
  );
}

export function ToolActivitySummaryCard(props: ToolActivitySummaryCardProps): JSX.Element {
  const {
    kicker,
    title,
    count,
    preview,
    secondaryLabel,
    steps = [],
    progress = null,
    artifactPaths = [],
    badgeTone = "default",
    active = false,
    showTitle = true,
    onClick
  } = props;
  const running = badgeTone === "running" || props.running === true;
  const hasPlan = progress !== null && progress.steps.length > 0;
  const className = ["tool-activity-card", steps.length > 0 ? "has-steps" : "", progress ? "has-progress" : "", active ? "active" : ""]
    .filter(Boolean).join(" ");

  return (
    <button type="button" className={className} onClick={onClick}>
      <div className="tool-activity-card-main">
        <div className="tool-activity-card-kicker-row">
          <span className="tool-activity-card-kicker">
            {badgeTone === "running" ? <LoaderCircle size={12} className="tool-activity-running-icon" /> : null}
            {kicker}
          </span>
          {preview ? <span className="tool-activity-card-preview">{preview}</span> : null}
          <ChevronRight size={13} className="tool-activity-card-chevron" aria-hidden="true" />
        </div>
        {!showTitle ? null : progress?.goal ? (
          <GoalTitle goal={progress.goal} title={title} count={count} progress={progress} secondaryLabel={secondaryLabel} />
        ) : (
          <CountTitle title={title} count={count} running={badgeTone === "running"} secondaryLabel={secondaryLabel} />
        )}
        {hasPlan
          ? <ActivityProgressSteps steps={progress.steps} detail={steps[steps.length - 1] ?? null} running={running} />
          : <ActivityStepTrail steps={steps} running={running} />}
        <ActivityArtifactChips paths={artifactPaths} />
      </div>
    </button>
  );
}
