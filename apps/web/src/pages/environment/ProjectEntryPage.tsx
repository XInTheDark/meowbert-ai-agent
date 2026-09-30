import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { getProjectMasterEnabled } from "@meowbert/shared/workspace-agent-settings";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { ProjectOverviewPage } from "./EnvironmentOverviewPage";

// Unless the workspace turned the Project Master off, opening a project lands in its Master conversation.
export function ProjectEntryPage() {
  const workspaceApp = useWorkspaceApp();
  const { api, activeWorkspaceId, workspaceSettings, isWorkspaceSettingsLoading, setFlash } = workspaceApp;
  const projectId = workspaceApp.activeProjectId ?? workspaceApp.activeEnvironmentId;
  const masterEnabled = getProjectMasterEnabled(workspaceSettings?.modelDefaults);
  const [master, setMaster] = useState<{ projectId: string; taskId: string | null } | null>(null);

  useEffect(() => {
    if (!workspaceSettings || !masterEnabled || !projectId) return;
    let cancelled = false;
    setMaster(null);
    api.post<{ taskId: string }>(`/api/projects/${projectId}/master`, {
      clientTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    }).then((result) => {
      if (!cancelled) setMaster({ projectId, taskId: result.taskId });
    }).catch((error: unknown) => {
      if (cancelled) return;
      setMaster({ projectId, taskId: null });
      setFlash({ tone: "error", text: error instanceof Error ? error.message : "Could not open the Project Master." });
    });
    return () => { cancelled = true; };
  }, [api, workspaceSettings, masterEnabled, projectId, setFlash]);

  if (!workspaceSettings && isWorkspaceSettingsLoading) return null;
  if (!masterEnabled || !projectId) return <ProjectOverviewPage />;
  if (!master || master.projectId !== projectId) return null;
  if (!master.taskId) return <ProjectOverviewPage />;
  return <Navigate replace to={`/app/${activeWorkspaceId}/projects/${projectId}/tasks/${master.taskId}`} />;
}
