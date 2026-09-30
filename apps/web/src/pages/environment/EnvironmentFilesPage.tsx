import { useState, useRef, useCallback, useEffect, useMemo, type FormEvent } from "react";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { useNavigate, useSearchParams, type NavigateFunction } from "react-router-dom";
import { normalizeProjectPathInput } from "../../project/projectFiles";
import { ProjectFilesView } from "./files/ProjectFilesView";
import { useProjectFileListing } from "./files/useProjectFileListing";
import { useProjectFilePreview } from "./files/useProjectFilePreview";
import { useProjectFileSelection } from "./files/useProjectFileSelection";
import { useProjectFileLiveSync } from "./files/useProjectFileLiveSync";
import { useProjectFileUploads } from "./files/useProjectFileUploads";
import { useProjectFileDownloads } from "./files/useProjectFileDownloads";
import { useProjectFileStorage } from "./files/useProjectFileStorage";
import { useProjectFileCleanup } from "./files/useProjectFileCleanup";

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

function navigateToFileScope(
  navigate: NavigateFunction,
  workspaceId: string | null,
  activeProjectId: string | null,
  target: string,
  scopeQuery: string
): void {
  if (!workspaceId || target === activeProjectId) {
    return;
  }
  if (target === "workspace") {
    navigate(`/app/${workspaceId}/files${scopeQuery}`);
    return;
  }
  navigate(`/app/${workspaceId}/projects/${target}/files${scopeQuery}`);
}

export function ProjectFilesPage() {
  const workspaceApp = useWorkspaceApp();
  const { api, token, activeWorkspaceId, setFlash } = workspaceApp;
  const activeProjectId = workspaceApp.activeProjectId ?? workspaceApp.activeEnvironmentId;
  const projects = workspaceApp.projects ?? workspaceApp.environments;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialPathFromUrl = searchParams.get("path") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [isCleanupMenuOpen, setIsCleanupMenuOpen] = useState(false);
  const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
  const closeActionMenus = useCallback(() => {
    setIsCleanupMenuOpen(false);
    setIsUploadMenuOpen(false);
  }, []);

  const resetSelectionRef = useRef<() => void>(() => undefined);
  const handleFileLoadStart = useCallback(() => resetSelectionRef.current(), []);
  const listing = useProjectFileListing({ api, projectId: activeProjectId, setError, onLoadStart: handleFileLoadStart });
  const selection = useProjectFileSelection({
    entries: listing.entries,
    onOpenDirectory: (relativePath) => {
      void listing.loadFiles(relativePath);
    },
    onContextMenuOpening: closeActionMenus
  });
  resetSelectionRef.current = selection.resetSelection;
  const filePreview = useProjectFilePreview({ api, projectId: activeProjectId, selectedEntry: selection.selectedEntry, setError });
  const { cwd, loadFiles } = listing;
  const liveSync = useProjectFileLiveSync({
    api,
    projectId: activeProjectId,
    cwd,
    selectedEntry: selection.selectedEntry,
    loadFiles,
    setSelectedPaths: selection.setSelectedPaths,
    setLastSelectedIndex: selection.setLastSelectedIndex,
    setError,
    setFlash
  });
  const scopeQuery = cwd ? `?path=${encodeURIComponent(cwd)}` : "";
  const activeProject = useMemo(() => projects.find((project) => project.id === activeProjectId) ?? null, [activeProjectId, projects]);
  const storage = useProjectFileStorage(api, activeProjectId);
  const cleanup = useProjectFileCleanup({
    projectId: activeProjectId,
    workspaceId: activeWorkspaceId,
    projectRootPath: activeProject?.root_path ?? null,
    cwd,
    loadFiles,
    storageSummary: storage.summary,
    storageMetrics: storage.metrics,
    updateStorage: storage.update,
    setError
  });

  const closeFileActionMenus = useCallback(() => {
    selection.setContextMenu(null);
    closeActionMenus();
  }, [closeActionMenus, selection.setContextMenu]);
  const uploads = useProjectFileUploads({
    projectId: activeProjectId,
    cwd,
    storageStatus: storage.status,
    loadFiles,
    loadStorageSummary: storage.load,
    setError,
    onPickerOpening: closeFileActionMenus
  });
  const downloads = useProjectFileDownloads({ projectId: activeProjectId, cwd, setError });

  useEffect(() => {
    closeActionMenus();
    setError(null);
    void loadFiles(initialPathFromUrl);
  }, [activeProjectId, closeActionMenus, initialPathFromUrl, loadFiles]);

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadFiles(normalizeProjectPathInput(listing.pathInput));
  };

  const handleScopeChange = (target: string) => navigateToFileScope(navigate, activeWorkspaceId, activeProjectId, target, scopeQuery);
  if (!activeProjectId) {
    return <NoProjectSelected />;
  }

  return (
    <ProjectFilesView
      projects={projects}
      activeProjectId={activeProjectId}
      token={token}
      error={error}
      isCleanupMenuOpen={isCleanupMenuOpen}
      setIsCleanupMenuOpen={setIsCleanupMenuOpen}
      isUploadMenuOpen={isUploadMenuOpen}
      setIsUploadMenuOpen={setIsUploadMenuOpen}
      listing={listing}
      selection={selection}
      preview={filePreview}
      liveSync={liveSync}
      storage={storage}
      cleanup={cleanup}
      uploads={uploads}
      downloads={downloads}
      onPathSubmit={handlePathSubmit}
      onScopeChange={handleScopeChange}
    />
  );
}

export const EnvironmentFilesPage = ProjectFilesPage;
