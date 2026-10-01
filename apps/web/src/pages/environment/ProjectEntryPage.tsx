import { useEffect } from "react";
import { getProjectMasterEnabled } from "@meowbert/shared/workspace-agent-settings";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { ProjectOverviewPage } from "./EnvironmentOverviewPage";
import { ProjectMasterLanding } from "./ProjectMasterLanding";
import { useProjectMasterTaskId } from "./useProjectMasterTaskId";

// Unless the workspace turned the Project Master off, a project opens on its Master conversation in place.
export function ProjectEntryPage() {
  const workspaceApp = useWorkspaceApp();
  const { api, activeWorkspaceId, workspaceSettings, isWorkspaceSettingsLoading, setFlash } = workspaceApp;
  const projectId = workspaceApp.activeProjectId ?? workspaceApp.activeEnvironmentId;
  const projects = workspaceApp.projects ?? workspaceApp.environments;
  const masterEnabled = getProjectMasterEnabled(workspaceSettings?.modelDefaults);
  const master = useProjectMasterTaskId(api, projectId, Boolean(workspaceSettings) && masterEnabled);
  const failureMessage = master.status === "failed" ? master.message : null;

  useEffect(() => {
    if (failureMessage) setFlash({ tone: "error", text: failureMessage });
  }, [failureMessage, setFlash]);

  if (!workspaceSettings && isWorkspaceSettingsLoading) return null;
  if (!masterEnabled || !projectId || master.status === "failed") return <ProjectOverviewPage />;
  return (
    <ProjectMasterLanding
      workspaceId={activeWorkspaceId}
      project={projects.find((project) => project.id === projectId) ?? null}
      masterTaskId={master.status === "ready" ? master.taskId : null}
    />
  );
}
