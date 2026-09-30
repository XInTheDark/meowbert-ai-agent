import { useEffect, useState } from "react";
import { ChevronRight, ListChecks } from "lucide-react";
import { Link } from "react-router-dom";
import { useOptionalWorkspaceApp } from "../../contexts/WorkspaceContext";
import type { TaskDetail } from "../../lib/types";
import type { ManagedTaskCardData } from "../../task/managedTaskCards";
import { TaskStatusBadge } from "../tasks/TaskStatusBadge";

const ACTIVE_STATUSES = new Set(["queued", "starting", "running", "interrupting"]);
const REFRESH_INTERVAL_MS = 5_000;

type LoadedTask = Pick<TaskDetail["task"], "title" | "status">;

function useManagedTask(taskId: string): LoadedTask | null {
  const workspaceApp = useOptionalWorkspaceApp();
  const api = workspaceApp?.api;
  const [task, setTask] = useState<LoadedTask | null>(null);

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async (): Promise<void> => {
      try {
        const detail = await api.get<TaskDetail>(`/api/tasks/${taskId}?messageDetail=none`);
        if (cancelled) return;
        setTask({ title: detail.task.title, status: detail.task.status });
        if (ACTIVE_STATUSES.has(detail.task.status)) timer = setTimeout(load, REFRESH_INTERVAL_MS);
      } catch {
        // The card still links to the task; the status just stays unknown.
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, taskId]);

  return task;
}

const ACTION_LABELS: Record<ManagedTaskCardData["action"], string> = {
  created: "Task created",
  started: "Task started",
  reported: "Task report"
};

export function ManagedTaskCard(props: { messageId: string; card: ManagedTaskCardData }): JSX.Element {
  const workspaceApp = useOptionalWorkspaceApp();
  const task = useManagedTask(props.card.taskId);
  const title = task?.title?.trim() || props.card.fallbackTitle || "Untitled task";
  const projectId = workspaceApp?.activeProjectId ?? workspaceApp?.activeEnvironmentId;
  const href = workspaceApp?.activeWorkspaceId && projectId
    ? `/app/${workspaceApp.activeWorkspaceId}/projects/${projectId}/tasks/${props.card.taskId}`
    : null;
  const body = (
    <>
      <ListChecks size={16} className="managed-task-card-icon" aria-hidden="true" />
      <span className="managed-task-card-copy">
        <span className="managed-task-card-kicker">{ACTION_LABELS[props.card.action]}</span>
        <span className="managed-task-card-title">{title}</span>
      </span>
      {task ? <TaskStatusBadge status={task.status} /> : null}
      {href ? <ChevronRight size={16} aria-hidden="true" /> : null}
    </>
  );

  return (
    <div className="chat-bubble assistant managed-task-card-bubble" data-message-id={props.messageId}>
      {href
        ? <Link to={href} className="managed-task-card" aria-label={`Open task: ${title}`}>{body}</Link>
        : <div className="managed-task-card">{body}</div>}
    </div>
  );
}
