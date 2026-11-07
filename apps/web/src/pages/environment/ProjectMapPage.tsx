import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { getProjectMasterEnabled } from "@meowbert/shared/workspace-agent-settings";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { ProjectMapView } from "./map/ProjectMapView";
import { useProjectMasterTaskId } from "./useProjectMasterTaskId";

// The project map at full width, where the board has room for its columns.
export function ProjectMapPage() {
  const workspaceApp = useWorkspaceApp();
  const { api, activeWorkspaceId, workspaceSettings } = workspaceApp;
  const projectId = workspaceApp.activeProjectId ?? workspaceApp.activeEnvironmentId;
  const project = (workspaceApp.projects ?? workspaceApp.environments).find((item) => item.id === projectId) ?? null;
  const navigate = useNavigate();
  const masterEnabled = Boolean(workspaceSettings) && getProjectMasterEnabled(workspaceSettings?.modelDefaults);
  const master = useProjectMasterTaskId(api, projectId, masterEnabled);
  if (!projectId) return null;
  const projectPath = `/app/${activeWorkspaceId}/projects/${projectId}`;
  return (
    <section className="project-map-page">
      <header className="project-map-page-header">
        <button type="button" className="icon-btn-subtle" aria-label="Back to project" onClick={() => navigate(projectPath)}><ArrowLeft size={17} /></button>
        <h1>{project?.name ? `${project.name} map` : "Project map"}</h1>
      </header>
      <ProjectMapView workspaceId={activeWorkspaceId} projectId={projectId} variant="page"
        masterTaskId={master.status === "ready" ? master.taskId : null} onAttached={() => navigate(projectPath)} />
    </section>
  );
}
