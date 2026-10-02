import { useSearchParams } from "react-router-dom";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { useProjectTaskBrowser } from "./overview/useProjectTaskBrowser";
import { useProjectPersistentShellSessions } from "./overview/useProjectPersistentShellSessions";
import { ProjectOverviewContent } from "./overview/ProjectOverviewContent";

export function ProjectOverviewPage() {
  const workspaceApp = useWorkspaceApp();
  const { api } = workspaceApp;
  const projects = workspaceApp.projects ?? workspaceApp.environments;
  const [searchParams] = useSearchParams();
  const browser = useProjectTaskBrowser(searchParams.get("q") ?? "");
  const { activeProjectId } = browser;
  const env = projects.find((project) => project.id === activeProjectId);
  const cachedProject = activeProjectId ? api.peekGet?.<typeof env>(`/api/projects/${activeProjectId}`) ?? null : null;
  const project = env ?? cachedProject ?? null;
  const persistentShells = useProjectPersistentShellSessions({
    api,
    projectId: activeProjectId,
    includeOutput: false
  });

  if (!project && (workspaceApp.isBootstrapping || workspaceApp.isEnvironmentsLoading)) {
    return (
      <section className="workbench-page">
        <article className="workbench-panel padded">
          <div className="project-command-header">
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: "0 0 0.2rem 0" }}>Loading project...</h3>
              <p className="muted-text" style={{ margin: 0 }}>Fetching project details.</p>
            </div>
          </div>
        </article>
      </section>
    );
  }

  if (!project) {
    return (
      <section className="workbench-page">
        <article className="workbench-empty">
          <h3>Project unavailable</h3>
          <p>Select another project from the left panel.</p>
        </article>
      </section>
    );
  }

  return (
    <ProjectOverviewContent
      project={project}
      browser={browser}
      activePersistentShellCount={persistentShells.items.length}
    />
  );
}

export const EnvironmentOverviewPage = ProjectOverviewPage;
