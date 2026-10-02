import { useCallback, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fileScopeRoute, projectFileScope } from "../../components/files/fileScope";
import { FilesView } from "../../components/files/FilesView";
import { useFileBrowser } from "../../components/files/useFileBrowser";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { ProjectCleanupMenu } from "./files/ProjectCleanupMenu";
import { ProjectCleanupPanel } from "./files/ProjectCleanupPanel";
import { useProjectFileCleanup } from "./files/useProjectFileCleanup";
import { useProjectFileLiveSync } from "./files/useProjectFileLiveSync";

function NoProjectSelected() {
  return (
    <section className="page-content">
      <article className="section-card empty-card">
        <h3>No project selected</h3>
        <p>Select a project to browse files.</p>
      </article>
    </section>
  );
}

export function ProjectFilesPage() {
  const workspaceApp = useWorkspaceApp();
  const { api, token, activeWorkspaceId, setFlash } = workspaceApp;
  const activeProjectId = workspaceApp.activeProjectId ?? workspaceApp.activeEnvironmentId;
  const projects = workspaceApp.projects ?? workspaceApp.environments;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isCleanupMenuOpen, setIsCleanupMenuOpen] = useState(false);
  const closeCleanupMenu = useCallback(() => setIsCleanupMenuOpen(false), []);
  const scope = useMemo(() => (activeProjectId ? projectFileScope(activeProjectId) : null), [activeProjectId]);
  const browser = useFileBrowser({ api, scope, initialPath: searchParams.get("path") ?? "", onCloseExtraMenus: closeCleanupMenu });
  const { listing, selection, storage, setError } = browser;
  const activeProject = useMemo(() => projects.find((project) => project.id === activeProjectId) ?? null, [activeProjectId, projects]);
  const liveSync = useProjectFileLiveSync({
    api,
    projectId: activeProjectId,
    cwd: listing.cwd,
    selectedEntry: selection.selectedEntry,
    loadFiles: listing.loadFiles,
    setSelectedPaths: selection.setSelectedPaths,
    setLastSelectedIndex: selection.setLastSelectedIndex,
    setError,
    setFlash
  });
  const cleanup = useProjectFileCleanup({
    projectId: activeProjectId,
    workspaceId: activeWorkspaceId,
    projectRootPath: activeProject?.root_path ?? null,
    storageSummary: storage.summary,
    storageMetrics: storage.metrics,
    updateStorage: storage.update,
    setError
  });
  const deletePaths = async (paths: string[]): Promise<void> => {
    if (await browser.deletion.deletePaths(paths)) {
      await cleanup.refreshPlan();
    }
  };

  if (!activeProjectId || !scope) {
    return <NoProjectSelected />;
  }

  return (
    <FilesView
      browser={browser}
      scope={scope}
      scopeValue={activeProjectId}
      projects={projects}
      token={token}
      onScopeChange={(target) => {
        if (activeWorkspaceId && target !== activeProjectId) navigate(fileScopeRoute(activeWorkspaceId, target, listing.cwd));
      }}
      onDelete={(paths) => void deletePaths(paths)}
      toolbarExtras={(
        <ProjectCleanupMenu
          isOpen={isCleanupMenuOpen}
          isLoading={cleanup.isLoading}
          onToggle={() => {
            const willOpen = !isCleanupMenuOpen;
            browser.closeMenus();
            setIsCleanupMenuOpen(willOpen);
          }}
          onCleanupRequest={() => {
            setIsCleanupMenuOpen(false);
            void cleanup.loadPlan();
          }}
          onAiCleanupRequest={() => {
            setIsCleanupMenuOpen(false);
            void cleanup.startAiCleanup();
          }}
        />
      )}
      topPanel={cleanup.plan ? (
        <ProjectCleanupPanel
          plan={cleanup.plan}
          filters={cleanup.filters}
          setFilters={cleanup.setFilters}
          targetPercent={cleanup.targetPercent}
          setTargetPercent={cleanup.setTargetPercent}
          selectedPaths={cleanup.selectedPaths}
          setSelectedPaths={cleanup.setSelectedPaths}
          selectedBytes={cleanup.selectedBytes}
          defaultSelectionCount={cleanup.defaultSelectionCount}
          isLoading={cleanup.isLoading}
          onLoadPlan={(targetPercent, filters) => void cleanup.loadPlan(targetPercent, filters)}
          onDeleteSelected={(paths) => void deletePaths(paths)}
        />
      ) : null}
      liveSync={{
        status: liveSync.status,
        isLoadingStatus: liveSync.isLoadingStatus,
        isMutating: liveSync.isMutating,
        onPull: (force) => void liveSync.mutate("pull", force),
        onPush: (force) => void liveSync.mutate("push", force),
        onOpenRemote: liveSync.openRemote,
        onUnlink: () => void liveSync.unlink(),
        reset: liveSync.reset
      }}
    />
  );
}

export const EnvironmentFilesPage = ProjectFilesPage;
