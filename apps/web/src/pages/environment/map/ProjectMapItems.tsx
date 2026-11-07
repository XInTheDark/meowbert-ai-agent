import { Link } from "react-router-dom";
import { StickyNote } from "lucide-react";
import type { ProjectMapCard, ProjectMapRollup, ProjectMapTask } from "@meowbert/shared/project-map";
import { getTaskStatusDisplay } from "../../../components/tasks/TaskStatusBadge";
import { ProjectMapRowMenu } from "./ProjectMapRowMenu";
import type { ProjectMapViewContext } from "./projectMapViewContext";

const ROLLUP_LABELS: Array<[keyof ProjectMapRollup, string]> = [
  ["active", "active"], ["needs_input", "need input"], ["failed", "failed"], ["done", "done"]
];

// Task counts for a folder and everything under it, one colored count per status group.
export function ProjectMapRollupBadges(props: { rollup: ProjectMapRollup | undefined }) {
  const parts = ROLLUP_LABELS.filter(([key]) => (props.rollup?.[key] ?? 0) > 0);
  if (!parts.length) return null;
  const title = parts.map(([key, label]) => `${props.rollup![key]} ${label}`).join(", ");
  return (
    <span className="project-map-rollup" title={title} aria-label={title}>
      {parts.map(([key]) => <span key={key} className={`project-map-rollup-count is-${key}`}>{props.rollup![key]}</span>)}
    </span>
  );
}

export function ProjectMapSelectBox(props: { ctx: ProjectMapViewContext; id: string; label: string }) {
  return (
    <input type="checkbox" className="project-map-select" checked={props.ctx.selection.isSelected(props.id)}
      onChange={() => props.ctx.selection.toggle(props.id)} onClick={(event) => event.stopPropagation()}
      aria-label={`Select ${props.label}`} />
  );
}

export function ProjectMapTaskItem(props: { ctx: ProjectMapViewContext; task: ProjectMapTask; variant: "row" | "card" }) {
  const { ctx, task } = props;
  const title = task.title ?? "Untitled task";
  const status = getTaskStatusDisplay(task.status);
  const StatusIcon = status.icon;
  return (
    <div className={`project-map-item is-task is-${props.variant}${ctx.selection.isSelected(task.id) ? " is-selected" : ""}`} {...ctx.drag.itemProps(task.id)}>
      <ProjectMapSelectBox ctx={ctx} id={task.id} label={title} />
      <StatusIcon size={14} className={`project-map-status is-${task.status}${status.spin ? " task-status-icon-spinning" : ""}`} aria-label={status.label} />
      <Link className="project-map-item-title" to={ctx.taskHref(task.id)} title={title}>{title}</Link>
    </div>
  );
}

export function ProjectMapCardItem(props: { ctx: ProjectMapViewContext; card: ProjectMapCard; variant: "row" | "card" }) {
  const { ctx, card } = props;
  return (
    <div className={`project-map-item is-note-card is-${props.variant}${ctx.selection.isSelected(card.id) ? " is-selected" : ""}`} {...ctx.drag.itemProps(card.id)}>
      <ProjectMapSelectBox ctx={ctx} id={card.id} label={card.title} />
      <StickyNote size={14} className="project-map-card-icon" aria-hidden="true" />
      <button type="button" className="project-map-item-title" title={card.body || card.title}
        onClick={() => ctx.openDialog({ kind: "edit-card", card })}>{card.title}</button>
      <span className={`project-map-card-state is-${card.state}`}>{card.state}</span>
      <ProjectMapRowMenu label={`More for ${card.title}`} items={[
        { label: "Edit", onSelect: () => ctx.openDialog({ kind: "edit-card", card }) },
        { label: "Delete", danger: true, onSelect: () => ctx.deleteCard(card.id) }
      ]} />
    </div>
  );
}
