import { LoadingScreen } from "../../components/LoadingScreen";
import { TaskDetailContent } from "./detail/TaskDetailContent";
import {
  useTaskDetailPageContext,
  type TaskDetailPageContext
} from "./detail/useTaskDetailPageContext";
import { useTaskDetailLoadedController } from "./detail/useTaskDetailLoadedController";

function TaskLoadFailure({ context }: { context: TaskDetailPageContext }) {
  return (
    <section className="page-content">
      <article className="section-card empty-card task-load-error-card">
        <h3>Couldn&apos;t open task</h3>
        <p className="error-text" style={{ marginTop: "0.35rem" }}>{context.data.taskLoadError}</p>
        <div style={{ display: "flex", gap: "0.7rem", justifyContent: "center", flexWrap: "wrap", marginTop: "0.8rem" }}>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              context.data.setIsTaskLoading(true);
              context.data.setTaskLoadError(null);
              void context.data.loadTask();
            }}
          >
            Try Again
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => context.navigate(
              `/app/${context.workspace.activeWorkspaceId}/projects/${context.activeProjectId}`
            )}
          >
            Back to Project
          </button>
        </div>
      </article>
    </section>
  );
}

function MissingProjectContext() {
  return (
    <section className="page-content">
      <article className="section-card empty-card" style={{ maxWidth: "40rem", margin: "0 auto" }}>
        <h3>Couldn&apos;t resolve project context</h3>
        <p className="error-text" style={{ marginTop: "0.35rem" }}>
          This task loaded, but the page could not determine which project route to use.
        </p>
      </article>
    </section>
  );
}

function LoadedTaskDetail({ context }: { context: TaskDetailPageContext }) {
  const model = useTaskDetailLoadedController(context);
  return <TaskDetailContent model={model} />;
}

export function TaskDetailPage() {
  const context = useTaskDetailPageContext();
  if (context.data.isTaskLoading && !context.data.taskDetail) {
    return <LoadingScreen label="Loading task..." />;
  }
  if (context.data.taskLoadError && !context.data.taskDetail) {
    return <TaskLoadFailure context={context} />;
  }
  if (!context.data.taskDetail) {
    return <LoadingScreen label="Loading task..." />;
  }
  if (!context.taskProjectId) {
    return <MissingProjectContext />;
  }
  return <LoadedTaskDetail context={context} />;
}
