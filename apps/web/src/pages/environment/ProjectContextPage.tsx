import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileBrowserEntries } from "../../components/files/FileBrowserEntries";
import { projectFileScope } from "../../components/files/fileScope";
import { useFileDownloads } from "../../components/files/useFileDownloads";
import { useFileDropZone } from "../../components/files/useFileDropZone";
import { useFilePreview } from "../../components/files/useFilePreview";
import { useFileSelection } from "../../components/files/useFileSelection";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { buildProjectContextPath, getProjectContextNotes, getProjectJsonPayload } from "../../lib/utils";
import { useAttachableSources } from "../../sources/useAttachableSources";
import type { WorkspaceSourceSummary } from "../../sources/sourceTypes";
import { stripContextPrefix } from "./context/contextPaths";
import { ProjectContextDialogs } from "./context/ProjectContextDialogs";
import { ProjectContextMenu } from "./context/ProjectContextMenu";
import { ProjectContextPreviewPane } from "./context/ProjectContextPreviewPane";
import { ProjectContextToolbar } from "./context/ProjectContextToolbar";
import { useProjectContextActions } from "./context/useProjectContextActions";
import { useProjectContextListing } from "./context/useProjectContextListing";

const DRAG_OVER_STYLE = { borderColor: "var(--brand)", boxShadow: "0 0 0 1px color-mix(in srgb, var(--brand) 30%, transparent)" };

function NoProjectSelected() {
  return (
    <section className="page-content">
      <article className="section-card empty-card">
        <h3>No project selected</h3>
        <p>Select a project to manage shared context.</p>
      </article>
    </section>
  );
}

// Files in a project's context folder, shared with every new task in the project.
export function ProjectContextPage() {
  const workspaceApp = useWorkspaceApp();
  const { api, token, activeWorkspaceId } = workspaceApp;
  const activeProjectId = workspaceApp.activeProjectId ?? workspaceApp.activeEnvironmentId;
  const projects = workspaceApp.projects ?? workspaceApp.environments;
  const project = projects.find((item) => item.id === activeProjectId) ?? null;
  const projectPayload = useMemo(() => getProjectJsonPayload(project), [project]);
  const contextNotes = useMemo(() => getProjectContextNotes(projectPayload), [projectPayload]);
  const scope = useMemo(() => (activeProjectId ? { ...projectFileScope(activeProjectId), archiveName: "project-context" } : null), [activeProjectId]);
  const [error, setError] = useState<string | null>(null);
  const [noteTargetPath, setNoteTargetPath] = useState<string | null>(null);
  const [isCreateTextFileOpen, setIsCreateTextFileOpen] = useState(false);
  const [selectedSource, setSelectedSource] = useState<WorkspaceSourceSummary | null>(null);
  const sources = useAttachableSources(api, activeWorkspaceId);

  const resetSelectionRef = useRef<() => void>(() => undefined);
  const handleLoadStart = useCallback(() => resetSelectionRef.current(), []);
  const listing = useProjectContextListing({ api, projectId: activeProjectId, setError, onLoadStart: handleLoadStart });
  const selection = useFileSelection({
    entries: listing.entries,
    onOpenDirectory: (relativePath) => void listing.loadEntries(stripContextPrefix(relativePath)),
    onContextMenuOpening: () => undefined
  });
  resetSelectionRef.current = selection.resetSelection;
  const preview = useFilePreview({ api, scope, selectedEntry: selection.selectedEntry, setError });
  const downloads = useFileDownloads({ scope, cwd: buildProjectContextPath(listing.cwd), setError });
  const actions = useProjectContextActions({ projectId: activeProjectId, projectPayload, listing, resetSelection: selection.resetSelection, setError });
  const { isDragOver, dropZoneHandlers } = useFileDropZone((files) => void actions.uploadFiles(files));
  const selectedEntry = selection.selectedEntry;
  const noteTargetEntry = noteTargetPath ? listing.entries.find((entry) => entry.relativePath === noteTargetPath) ?? null : null;

  useEffect(() => {
    setNoteTargetPath(null);
    setError(null);
    void listing.loadEntries("");
  }, [activeProjectId, listing.loadEntries]);

  if (!activeProjectId || !project || !scope) {
    return <NoProjectSelected />;
  }

  return (
    <section className="page-content" onClick={() => selection.setContextMenu(null)} {...dropZoneHandlers}>
      <article className="section-card files-layout-card project-context-card" style={isDragOver ? DRAG_OVER_STYLE : undefined}>
        <ProjectContextToolbar
          cwd={listing.cwd}
          parentPath={listing.parentPath}
          isLoading={listing.isLoading}
          viewMode={selection.viewMode}
          selectedCount={selection.selectedRelativePaths.length}
          isUploading={actions.isUploading}
          sources={sources}
          onNavigate={(path) => void listing.loadEntries(path)}
          onViewModeChange={selection.setViewMode}
          onRemoveSelected={() => void actions.deletePaths(selection.selectedRelativePaths)}
          onUploadFiles={(files) => void actions.uploadFiles(files)}
          onCreateTextFile={() => setIsCreateTextFileOpen(true)}
          onAttachFromSource={setSelectedSource}
        />
        <div className="project-context-helper-bar">
          <div className="muted-text project-context-helper-copy">
            Files here are available to every new task in this project. Drop files or folders to add them.
          </div>
        </div>
        <div className="files-main">
          <FileBrowserEntries
            isLoadingList={listing.isLoading}
            entries={listing.entries}
            sortedEntries={selection.sortedEntries}
            viewMode={selection.viewMode}
            selectedPaths={selection.selectedPaths}
            allEntriesSelected={selection.allEntriesSelected}
            onToggleSelectAll={selection.onToggleSelectAll}
            onSortToggle={selection.onSortToggle}
            renderSortIndicator={selection.renderSortIndicator}
            onEntryClick={selection.onEntryClick}
            onEntryDoubleClick={selection.onEntryDoubleClick}
            onContextMenu={selection.onContextMenu}
            onCheckboxClick={selection.onCheckboxClick}
          />
          <ProjectContextPreviewPane
            selectedEntry={selectedEntry}
            selectedCount={selection.selectedPaths.size}
            filePreview={preview.preview}
            isLoadingPreview={preview.isLoading}
            isDownloading={downloads.isDownloading}
            previewDownloadUrl={selectedEntry ? scope.downloadUrl(selectedEntry.relativePath) : null}
            previewToken={token}
            onDownload={(relativePath) => void downloads.download([relativePath])}
            onEditNote={() => setNoteTargetPath(selectedEntry?.relativePath ?? null)}
            onClose={selection.resetSelection}
          />
        </div>
        {error ? <div className="error-banner" style={{ borderRadius: 0 }}>{error}</div> : null}
      </article>

      <ProjectContextMenu
        contextMenu={selection.contextMenu}
        selectedRelativePaths={selection.selectedRelativePaths}
        selectedPathSet={selection.selectedPaths}
        hasNoteForPath={!!(selection.contextMenu?.path && contextNotes[selection.contextMenu.path])}
        isDownloading={downloads.isDownloading}
        onDownload={(paths) => void downloads.download(paths)}
        onEditNote={() => setNoteTargetPath(selection.contextMenu?.path ?? null)}
        onDelete={(paths) => void actions.deletePaths(paths)}
        onRefresh={() => void listing.loadEntries(listing.cwd)}
        onClose={() => selection.setContextMenu(null)}
      />
      <ProjectContextDialogs
        api={api}
        workspaceId={activeWorkspaceId}
        projectId={activeProjectId}
        contextPath={buildProjectContextPath(listing.cwd)}
        noteTargetEntry={noteTargetEntry}
        isCreateTextFileOpen={isCreateTextFileOpen}
        selectedSource={selectedSource}
        onCloseNote={() => setNoteTargetPath(null)}
        onSaveNote={actions.saveNote}
        onCloseCreateTextFile={() => setIsCreateTextFileOpen(false)}
        onCreateTextFile={actions.createTextFile}
        onCloseSource={() => setSelectedSource(null)}
        onImportSourceAttachments={(attachments) => void actions.importSourceAttachments(attachments)}
      />
    </section>
  );
}

export const EnvironmentContextPage = ProjectContextPage;
