import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CircleEllipsis,
  Clock3,
  LoaderCircle,
  XOctagon,
  type LucideIcon
} from "lucide-react";
import { badgeClass } from "../../lib/utils";

interface TaskStatusDisplay {
  icon: LucideIcon;
  label: string;
  spin?: boolean;
}

function getUnknownStatusLabel(status: string): string {
  return status
    .split("_")
    .filter((part) => part.length > 0)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getTaskStatusDisplay(status: string): TaskStatusDisplay {
  switch (status) {
    case "queued":
      return { icon: Clock3, label: "Queued" };
    case "starting":
      return { icon: LoaderCircle, label: "Starting", spin: true };
    case "running":
      return { icon: LoaderCircle, label: "Running", spin: true };
    case "awaiting_input":
      return { icon: CircleEllipsis, label: "Awaiting Input" };
    case "succeeded":
      return { icon: CheckCircle2, label: "Succeeded" };
    case "failed":
      return { icon: AlertTriangle, label: "Failed" };
    case "cancelled":
      return { icon: Ban, label: "Cancelled" };
    case "interrupting":
      return { icon: XOctagon, label: "Interrupting" };
    default:
      return { icon: CircleEllipsis, label: getUnknownStatusLabel(status) || status };
  }
}

interface TaskStatusBadgeProps {
  status: string;
  className?: string;
  iconSize?: number;
  title?: string;
}

export function TaskStatusBadge(props: TaskStatusBadgeProps) {
  const display = getTaskStatusDisplay(props.status);
  const StatusIcon = display.icon;
  const className = [badgeClass(props.status), props.className].filter(Boolean).join(" ");

  return (
    <span className={className} title={props.title ?? display.label}>
      <StatusIcon
        size={props.iconSize ?? 13}
        aria-hidden="true"
        className={display.spin ? "task-status-icon task-status-icon-spinning" : "task-status-icon"}
      />
      <span className="task-status-text">{display.label}</span>
    </span>
  );
}
