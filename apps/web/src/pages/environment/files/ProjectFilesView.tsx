import type { Dispatch, FormEventHandler, SetStateAction } from "react";
import type { Project } from "../../../lib/types";
import { buildDownloadUrl } from "../../../lib/utils";
import { ProjectCleanupPanel } from "./ProjectCleanupPanel";
import { ProjectFileBrowser } from "./ProjectFileBrowser";
import { ProjectFilesContextMenu } from "./ProjectFilesContextMenu";
import { ProjectFilesPreviewPane } from "./ProjectFilesPreviewPane";
import { ProjectFilesToolbar } from "./ProjectFilesToolbar";
import type { useProjectFileCleanup } from "./useProjectFileCleanup";
import type { useProjectFileDownloads } from "./useProjectFileDownloads";
import type { useProjectFileListing } from "./useProjectFileListing";
import type { useProjectFileLiveSync } from "./useProjectFileLiveSync";
import type { useProjectFilePreview } from "./useProjectFilePreview";
import type { useProjectFileSelection } from "./useProjectFileSelection";
import type { useProjectFileStorage } from "./useProjectFileStorage";
import type { useProjectFileUploads } from "./useProjectFileUploads";

interface ProjectFilesViewProps {
  projects: Project[];
  activeProjectId: string;
  token: string | null;
  error: string | null;
  isCleanupMenuOpen: boolean;
  setIsCleanupMenuOpen: Dispatch<SetStateAction<boolean>>;
  isUploadMenuOpen: boolean;
  setIsUploadMenuOpen: Dispatch<SetStateAction<boolean>>;
  listing: ReturnType<typeof useProjectFileListing>;
  selection: ReturnType<typeof useProjectFileSelection>;
  preview: ReturnType<typeof useProjectFilePreview>;
  liveSync: ReturnType<typeof useProjectFileLiveSync>;
  storage: ReturnType<typeof useProjectFileStorage>;
  cleanup: ReturnType<typeof useProjectFileCleanup>;
  uploads: ReturnType<typeof useProjectFileUploads>;
  downloads: ReturnType<typeof useProjectFileDownloads>;
  onPathSubmit: FormEventHandler<HTMLFormElement>;
  onScopeChange: (target: string) => void;
}

export function ProjectFilesView(props: ProjectFilesViewProps) {
  const closeMenus = (): void => {
    props.selection.setContextMenu(null);
    props.setIsCleanupMenuOpen(false);
    props.setIsUploadMenuOpen(false);
  };
  return (
    <section className="page-content" onClick={closeMenus}>
      <article className="section-card files-layout-card">
        <ProjectFilesToolbarSection {...props} />
        {props.cleanup.plan ? <ProjectFilesCleanupSection cleanup={props.cleanup} /> : null}
        <ProjectFileUploadInputs uploads={props.uploads} />
        <ProjectFilesMain {...props} />
        {props.error ? <div className="error-banner project-files-error">{props.error}</div> : null}
      </article>
      <ProjectFilesContextMenu
        contextMenu={props.selection.contextMenu}
        selectedRelativePaths={props.selection.selectedRelativePaths}
        selectedPathSet={props.selection.selectedPaths}
        isDownloading={props.downloads.isDownloading}
        onDownload={(paths) => void props.downloads.download(paths)}
        onRefresh={() => void props.listing.loadFiles(props.listing.cwd)}
        onClose={() => props.selection.setContextMenu(null)}
      />
    </section>
  );
}

function ProjectFilesToolbarSection(props: ProjectFilesViewProps) {
  return (
    <ProjectFilesToolbar
      projects={props.projects}
      activeProjectId={props.activeProjectId}
      parentPath={props.listing.parentPath}
      pathInput={props.listing.pathInput}
      viewMode={props.selection.viewMode}
      selectedCount={props.selection.selectedRelativePaths.length}
      isLoadingList={props.listing.isLoading}
      isDownloading={props.downloads.isDownloading}
      storageSummary={props.storage.summary}
      storageStatus={props.storage.status}
      storageMetrics={props.storage.metrics}
      isStorageExpanded={props.storage.isExpanded}
      isCleanupMenuOpen={props.isCleanupMenuOpen}
      isLoadingCleanup={props.cleanup.isLoading}
      isUploadMenuOpen={props.isUploadMenuOpen}
      isUploading={props.uploads.isUploading}
      onNavigate={(path) => void props.listing.loadFiles(path)}
      onPathInputChange={props.listing.setPathInput}
      onPathSubmit={props.onPathSubmit}
      onScopeChange={props.onScopeChange}
      onViewModeChange={props.selection.setViewMode}
      onStorageRequest={() => {
        props.storage.setIsExpanded(true);
        void props.storage.load();
      }}
      onStorageExpandedChange={props.storage.setIsExpanded}
      onDownload={() => void props.downloads.download(props.selection.selectedRelativePaths)}
      onDelete={() => void props.cleanup.deletePaths(props.selection.selectedRelativePaths)}
      onCleanupMenuToggle={() => {
        props.selection.setContextMenu(null);
        props.setIsUploadMenuOpen(false);
        props.setIsCleanupMenuOpen((current) => !current);
      }}
      onCleanupRequest={() => {
        props.setIsCleanupMenuOpen(false);
        void props.cleanup.loadPlan();
      }}
      onAiCleanupRequest={() => {
        props.setIsCleanupMenuOpen(false);
        void props.cleanup.startAiCleanup();
      }}
      onUploadMenuToggle={() => {
        props.selection.setContextMenu(null);
        props.setIsCleanupMenuOpen(false);
        props.setIsUploadMenuOpen((current) => !current);
      }}
      onUploadFiles={() => void props.uploads.openFilePicker()}
      onUploadFolder={props.uploads.openFolderPicker}
    />
  );
}

function ProjectFilesCleanupSection(props: Pick<ProjectFilesViewProps, "cleanup">) {
  const cleanup = props.cleanup;
  if (!cleanup.plan) {
    return null;
  }
  return (
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
      onDeleteSelected={(paths) => void cleanup.deletePaths(paths)}
    />
  );
}

function ProjectFileUploadInputs(props: Pick<ProjectFilesViewProps, "uploads">) {
  const handleFiles = (files: FileList | null): void => {
    void props.uploads.uploadFiles(files ? Array.from(files) : []);
  };
  return (
    <>
      <input ref={props.uploads.fileInputRef} type="file" hidden multiple onChange={(event) => {
        handleFiles(event.target.files);
        event.target.value = "";
      }} />
      <input ref={props.uploads.setFolderInputElement} type="file" hidden multiple onChange={(event) => {
        handleFiles(event.target.files);
        event.target.value = "";
      }} />
    </>
  );
}

function ProjectFilesMain(props: ProjectFilesViewProps) {
  const selectedEntry = props.selection.selectedEntry;
  return (
    <div className="files-main">
      <ProjectFileBrowser
        isLoadingList={props.listing.isLoading}
        entries={props.listing.entries}
        sortedEntries={props.selection.sortedEntries}
        viewMode={props.selection.viewMode}
        selectedPaths={props.selection.selectedPaths}
        allEntriesSelected={props.selection.allEntriesSelected}
        onToggleSelectAll={props.selection.onToggleSelectAll}
        onSortToggle={props.selection.onSortToggle}
        renderSortIndicator={props.selection.renderSortIndicator}
        onEntryClick={props.selection.onEntryClick}
        onEntryDoubleClick={props.selection.onEntryDoubleClick}
        onContextMenu={props.selection.onContextMenu}
        onCheckboxClick={props.selection.onCheckboxClick}
      />
      <ProjectFilesPreviewPane
        selectedEntry={selectedEntry}
        filePreview={props.preview.preview}
        selectedCount={props.selection.selectedPaths.size}
        isLoadingPreview={props.preview.isLoading}
        isDownloading={props.downloads.isDownloading}
        previewDownloadUrl={selectedEntry ? buildDownloadUrl(props.activeProjectId, selectedEntry.relativePath) : null}
        previewToken={props.token}
        liveSyncStatus={props.liveSync.status}
        isLiveSyncStatusLoading={props.liveSync.isLoadingStatus}
        isLiveSyncMutating={props.liveSync.isMutating}
        onDownload={(path) => void props.downloads.download([path])}
        onLiveSyncPull={(force) => void props.liveSync.mutate("pull", force)}
        onLiveSyncPush={(force) => void props.liveSync.mutate("push", force)}
        onLiveSyncOpenRemote={props.liveSync.openRemote}
        onLiveSyncUnlink={() => void props.liveSync.unlink()}
        onClose={() => {
          props.selection.setSelectedPaths(new Set());
          props.selection.setLastSelectedIndex(null);
          props.preview.setPreview(null);
          props.liveSync.reset();
        }}
      />
    </div>
  );
}
