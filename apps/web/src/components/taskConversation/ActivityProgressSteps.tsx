import { CheckCircle2, Circle, CircleDot, LoaderCircle } from "lucide-react";
import type { TaskProgressStep } from "@meowbert/shared/task-progress";

function StepIcon(props: { status: TaskProgressStep["status"]; running: boolean }): JSX.Element {
  if (props.status === "done") return <CheckCircle2 size={14} aria-hidden="true" />;
  if (props.status === "pending") return <Circle size={14} aria-hidden="true" />;
  return props.running
    ? <LoaderCircle size={14} className="tool-activity-running-icon" aria-hidden="true" />
    : <CircleDot size={14} aria-hidden="true" />;
}

// The agent's steps as a segmented bar and a list. The latest step summary sits under the active
// step, so the card shows both where the task is and what the agent is doing right now.
export function ActivityProgressSteps(props: {
  steps: TaskProgressStep[];
  detail: string | null;
  running: boolean;
}): JSX.Element {
  return (
    <span className="tool-activity-progress">
      <span className="tool-activity-progress-bar" aria-hidden="true">
        {props.steps.map((step, index) => (
          <span key={index} className={`tool-activity-progress-segment ${step.status}`} />
        ))}
      </span>
      <span className="tool-activity-progress-steps" role="list" aria-label="Progress">
        {props.steps.map((step, index) => (
          <span key={index} className={`tool-activity-progress-step ${step.status}`} role="listitem">
            <StepIcon status={step.status} running={props.running} />
            <span className="tool-activity-progress-step-text">
              <span className="tool-activity-progress-step-title">{step.title}</span>
              {step.status === "active" && props.detail ? (
                <span className={`tool-activity-progress-step-detail${props.running ? " running" : ""}`}>{props.detail}</span>
              ) : null}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}
