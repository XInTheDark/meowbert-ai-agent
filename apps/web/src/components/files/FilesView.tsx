import type { FormEvent, ReactNode } from "react";
import type { EnvironmentFileLiveSyncStatus, Project } from "../../lib/types";
import { normalizeProjectPathInput } from "../../project/projectFiles";
import { FileBrowserContextMenu } from "./FileBrowserContextMenu";
import { FileBrowserEntries } from "./FileBrowserEntries";
import { FilePreviewPane } from "./FilePreviewPane";
import { FileStorageIndicator } from "./FileStorageIndicator";
import { FilesToolbar } from "./FilesToolbar";
import type { FileScope } from "./fileScope";
import type { FileBrowser } from "./useFileBrowser";

export interface FilesViewLiveSync {
  status: EnvironmentFileLiveSyncStatus | null;
  isLoadingStatus: boolean;
  isMutating: boolean;
  onPull: (force?: boolean) => void;
  onPush: (force?: boolean) => void;
  onOpenRemote: () => void;
  onUnlink: () => void;
  reset: () => void;
}

interface FilesViewProps {
  browser: FileBrowser;
  scope: FileScope;
  scopeValue: string;
  projects: Project[];
  token: string | null;
  onScopeChange: (scopeValue: string) => void;
  onDelete: (paths: string[]) => void;
  toolbarExtras?: ReactNode;
  topPanel?: ReactNode;
  liveSync?: FilesViewLiveSync;
}

// The workspace and project file browsers: toolbar, file list, preview pane and context menu.
export function FilesView(props: FilesViewProps) {
  const { browser } = props;
  return (
    <section className="page-content" onClick={browser.closeMenus}>
      <article className="section-card files-layout-card">
        <FilesToolbarSection {...props} />
        {props.topPanel}
        <FileUploadInputs browser={browser} />
        <FilesMain {...props} />
        {browser.error ? <div className="error-banner project-files-error">{browser.error}</div> : null}
      </article>
      <FileBrowserContextMenu
        contextMenu={browser.selection.contextMenu}
        selectedRelativePaths={browser.selection.selectedRelativePaths}
        selectedPathSet={browser.selection.selectedPaths}
        isDownloading={browser.downloads.isDownloading}
        onDownload={(paths) => void browser.downloads.download(paths)}
        onRefresh={() => void browser.listing.loadFiles(browser.listing.cwd)}
        onClose={() => browser.selection.setContextMenu(null)}
      />
    </section>
  );
}

function FilesToolbarSection(props: FilesViewProps) {
  const { listing, selection, storage, uploads, downloads } = props.browser;
  return (
    <FilesToolbar
      projects={props.projects}
      scopeValue={props.scopeValue}
      parentPath={listing.parentPath}
      pathInput={listing.pathInput}
      viewMode={selection.viewMode}
      selectedCount={selection.selectedRelativePaths.length}
      isLoadingList={listing.isLoading}
      isDownloading={downloads.isDownloading}
      storageIndicator={(
        <FileStorageIndicator
          summary={storage.summary}
          metrics={storage.metrics}
          isExpanded={storage.isExpanded}
          onExpandedChange={storage.setIsExpanded}
        />
      )}
      extraActions={props.toolbarExtras}
      isUploadMenuOpen={props.browser.isUploadMenuOpen}
      isUploading={uploads.isUploading}
      onNavigate={(path) => void listing.loadFiles(path)}
      onPathInputChange={listing.setPathInput}
      onPathSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void listing.loadFiles(normalizeProjectPathInput(listing.pathInput));
      }}
      onScopeChange={props.onScopeChange}
      onViewModeChange={selection.setViewMode}
      onDownload={() => void downloads.download(selection.selectedRelativePaths)}
      onDelete={() => props.onDelete(selection.selectedRelativePaths)}
      onUploadMenuToggle={() => {
        const willOpen = !props.browser.isUploadMenuOpen;
        props.browser.closeMenus();
        props.browser.setIsUploadMenuOpen(willOpen);
      }}
      onUploadFiles={() => void uploads.openFilePicker()}
      onUploadFolder={uploads.openFolderPicker}
    />
  );
}

function FileUploadInputs(props: { browser: FileBrowser }) {
  const { uploads } = props.browser;
  const handleFiles = (files: FileList | null): void => {
    void uploads.uploadFiles(files ? Array.from(files) : []);
  };
  return (
    <>
      <input ref={uploads.fileInputRef} type="file" hidden multiple onChange={(event) => {
        handleFiles(event.target.files);
        event.target.value = "";
      }} />
      <input ref={uploads.setFolderInputElement} type="file" hidden multiple onChange={(event) => {
        handleFiles(event.target.files);
        event.target.value = "";
      }} />
    </>
  );
}

function FilesMain(props: FilesViewProps) {
  const { listing, selection, preview, downloads } = props.browser;
  const selectedEntry = selection.selectedEntry;
  const liveSync = props.liveSync;
  return (
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
      <FilePreviewPane
        selectedEntry={selectedEntry}
        filePreview={preview.preview}
        selectedCount={selection.selectedPaths.size}
        isLoadingPreview={preview.isLoading}
        isDownloading={downloads.isDownloading}
        previewDownloadUrl={selectedEntry ? props.scope.downloadUrl(selectedEntry.relativePath) : null}
        previewToken={props.token}
        liveSyncStatus={liveSync?.status ?? null}
        isLiveSyncStatusLoading={liveSync?.isLoadingStatus ?? false}
        isLiveSyncMutating={liveSync?.isMutating ?? false}
        onDownload={(path) => void downloads.download([path])}
        onLiveSyncPull={liveSync?.onPull}
        onLiveSyncPush={liveSync?.onPush}
        onLiveSyncOpenRemote={liveSync?.onOpenRemote}
        onLiveSyncUnlink={liveSync?.onUnlink}
        onClose={() => {
          selection.setSelectedPaths(new Set());
          selection.setLastSelectedIndex(null);
          preview.setPreview(null);
          liveSync?.reset();
        }}
      />
    </div>
  );
}
