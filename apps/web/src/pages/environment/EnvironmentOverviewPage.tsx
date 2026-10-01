import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import { useProjectTaskActions } from "./overview/useProjectTaskActions";
import { useProjectTaskFolders } from "./overview/useProjectTaskFolders";
import { useProjectTaskList } from "./overview/useProjectTaskList";
import { useTaskColumnWidths } from "./overview/useTaskColumnWidths";
import { useProjectPersistentShellSessions } from "./overview/useProjectPersistentShellSessions";
import { ProjectOverviewContent } from "./overview/ProjectOverviewContent";

export function ProjectOverviewPage() {
  const workspaceApp = useWorkspaceApp();
  const { api, activeWorkspaceId, setFlash } = workspaceApp;
  const activeProjectId = workspaceApp.activeProjectId ?? workspaceApp.activeEnvironmentId;
  const projects = workspaceApp.projects ?? workspaceApp.environments;
  const { publicServerConfig } = useAppRuntime();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const env = projects.find((project) => project.id === activeProjectId);
  const cachedProject = activeProjectId ? api.peekGet?.<typeof env>(`/api/projects/${activeProjectId}`) ?? null : null;
  const project = env ?? cachedProject ?? null;
  const publicBaseUrl = publicServerConfig?.appUrl ?? window.location.origin;

  const taskList = useProjectTaskList(api, activeProjectId, searchParams.get("q") ?? "");
  const taskFoldersState = useProjectTaskFolders(api, activeProjectId, taskList.refreshNonce);
  const taskColumns = useTaskColumnWidths();
  const persistentShells = useProjectPersistentShellSessions({
    api,
    projectId: activeProjectId,
    includeOutput: false
  });
  const taskActions = useProjectTaskActions({
    api,
    activeProjectId,
    activeWorkspaceId,
    publicBaseUrl,
    navigate,
    setFlash,
    tasks: taskList.tasks,
    folderFilter: taskList.folderFilter,
    setFolderFilter: taskList.setFolderFilter,
    setCollapsedFolderIds: taskFoldersState.setCollapsedFolderIds,
    setRefreshNonce: taskList.setRefreshNonce
  });

  useEffect(() => {
    taskActions.setSelectedTaskIds([]);
    taskActions.setMoveTarget(null);
    taskActions.setOpenMenuId(null);
  }, [activeProjectId]);

  useEffect(() => {
    const visibleTaskIds = new Set(taskList.tasks.map((task) => task.id));
    taskActions.setSelectedTaskIds((current) => current.filter((taskId) => visibleTaskIds.has(taskId)));
  }, [taskList.tasks]);


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
      activeWorkspaceId={activeWorkspaceId}
      navigate={navigate}
      taskList={taskList}
      folders={taskFoldersState}
      actions={taskActions}
      columns={taskColumns}
      activePersistentShellCount={persistentShells.items.length}
    />
  );
}

export const EnvironmentOverviewPage = ProjectOverviewPage;
