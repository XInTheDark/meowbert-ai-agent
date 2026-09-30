import { useNavigate } from "react-router-dom";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { PersistentShellsPanel } from "./overview/PersistentShellsPanel";
import { useProjectPersistentShellSessions } from "./overview/useProjectPersistentShellSessions";

export function ProjectPersistentShellsPage() {
  const workspaceApp = useWorkspaceApp();
  const { api, activeWorkspaceId } = workspaceApp;
  const projectId = workspaceApp.activeProjectId ?? workspaceApp.activeEnvironmentId;
  const projects = workspaceApp.projects ?? workspaceApp.environments;
  const project = projects.find((item) => item.id === projectId) ?? null;
  const navigate = useNavigate();
  const shells = useProjectPersistentShellSessions({
    api,
    projectId,
    includeOutput: true
  });

  if (!projectId || !project) {
    return (
      <section className="workbench-page">
        <article className="workbench-empty">Select a project to view background shells.</article>
      </section>
    );
  }

  return (
    <section className="workbench-page">
      <PersistentShellsPanel
        kicker={project.name}
        title="Background shells"
        description="Read-only live output from active project shell sessions."
        items={shells.items}
        isLoading={shells.isLoading}
        error={shells.error}
        onRefresh={shells.refresh}
        onTerminate={shells.terminateSession}
        onTerminateAll={shells.terminateAll}
        emptyMessage="No active background shells."
        actions={(
          <button
            type="button"
            className="btn ghost"
            onClick={() => navigate(`/app/${activeWorkspaceId}/projects/${projectId}`)}
          >
            Back to overview
          </button>
        )}
      />
    </section>
  );
}
