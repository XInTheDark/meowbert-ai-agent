import { useCallback, useEffect, useMemo, useState, type FormEvent, type MouseEvent } from "react";
import {
  ArrowUp,
  Copy,
  FileSearch,
  Home,
  Info,
  Link2,
  RefreshCw,
  Search,
  X,
  type LucideIcon
} from "lucide-react";
import type { ApiClient } from "../../lib/api";
import {
  type FileSortColumn
} from "../../environment/environmentFiles";
import type {
  EnvironmentFileEntry,
  TaskAttachment
} from "../../lib/types";
import { FileBrowserEntries } from "../files/FileBrowserEntries";
import type {
  SourceBrowseResponse,
  SourceFileEntry,
  SourcePathResponse,
  SourceSearchResponse,
  WorkspaceSourceAttachedFile,
  WorkspaceSourceAttachResponse,
  WorkspaceSourceSummary
} from "../../sources/sourceTypes";
import { canUseWorkspaceSourceLiveSync } from "../../sources/sourceTypes";
import { toTaskAttachmentFromSourceAttachment } from "../../sources/sourceAttachments";
import { getDirectGoogleWorkspaceEntries } from "../../sources/googleWorkspaceAttachments";
import { TASK_FILE_DESTINATION_PENDING_MESSAGE } from "../../task/taskFileDestinations";
import { SourceNoteAttachmentModal } from "./SourceNoteAttachmentModal";
import {
  GoogleWorkspaceAttachmentModeDialog,
  type GoogleWorkspaceAttachmentMode
} from "./GoogleWorkspaceAttachmentModeDialog";
import {
  sortSourceBrowserEntries,
  toSourceBrowserEntry,
  type SourcePickerMode,
  type SourcePickerSortColumn
} from "./sourceFilePickerEntries";
import {
  SourceFilePickerPathRibbon,
  type SourceBreadcrumbItem
} from "./SourceFilePickerPathRibbon";

interface SourceFilePickerModalProps {
  api: ApiClient;
  workspaceId: string | null;
  projectId?: string | null;
  environmentId: string | null;
  taskId?: string | null;
  source: WorkspaceSourceSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (attachments: TaskAttachment[]) => void;
  targetLabel?: string;
  destinationPath?: string | null;
  createDirectories?: boolean;
  toAttachmentPath?: (uploaded: WorkspaceSourceAttachedFile) => string;
}

type SourceAttachFileMode = "copy" | "live_sync";
type SourceLookupMode = "search" | "path";

function describeSourceSelection(selectedCount: number, fileMode: SourceAttachFileMode): string {
  if (selectedCount === 0) {
    return "No attachable items selected";
  }

  const noun = fileMode === "live_sync" ? "item" : "file";
  return `${selectedCount} ${noun}${selectedCount === 1 ? "" : "s"} selected`;
}

function getSourceAttachFileModeMeta(mode: SourceAttachFileMode): {
  label: string;
  Icon: LucideIcon;
} {
  if (mode === "live_sync") {
    return {
      label: "Live sync",
      Icon: RefreshCw
    };
  }

  return {
    label: "Copy",
    Icon: Copy
  };
}

function isSourcePathOnly(provider: WorkspaceSourceSummary["provider"]): boolean {
  return provider === "rclone";
}

function getSourceLookupPlaceholder(provider: WorkspaceSourceSummary["provider"], lookupMode: SourceLookupMode): string {
  if (lookupMode === "path") {
    if (provider === "google-drive") {
      return "Paste link or enter path";
    }
    if (provider === "rclone") {
      return "Enter file or folder path";
    }
    return "Enter file or folder path";
  }

  if (provider === "rclone") {
    return "Enter file or folder path";
  }
  return "Search current folder";
}

function getSourceLookupAriaLabel(provider: WorkspaceSourceSummary["provider"], lookupMode: SourceLookupMode): string {
  if (lookupMode === "path") {
    if (provider === "google-drive") {
      return "Look up a Google Drive link or file path";
    }
    return "Look up a source file or folder path";
  }

  if (provider === "rclone") {
    return "Look up an rclone file or folder path";
  }
  return "Search current source folder";
}

function getSourceLookupModeTitle(provider: WorkspaceSourceSummary["provider"], lookupMode: SourceLookupMode): string {
  if (isSourcePathOnly(provider)) {
    return "rclone supports path lookup only";
  }
  return lookupMode === "search" ? "Search mode. Click to switch to path mode." : "Path mode. Click to switch to search mode.";
}

export function SourceFilePickerModal(props: SourceFilePickerModalProps) {
  const targetEnvironmentId = props.projectId ?? props.environmentId;
  if (props.source?.attachmentMode === "note") {
    return (
      <SourceNoteAttachmentModal
        api={props.api}
        workspaceId={props.workspaceId}
        source={props.source}
        isOpen={props.isOpen}
        onClose={props.onClose}
        onSelect={props.onSelect}
        targetLabel={props.targetLabel}
      />
    );
  }

  return <SourceFilePickerFileModal {...props} />;
}

function SourceFilePickerFileModal(props: SourceFilePickerModalProps) {
  const [mode, setMode] = useState<SourcePickerMode>("browse");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [currentFolderName, setCurrentFolderName] = useState<string>("Root");
  const [parentFolderId, setParentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<SourceBreadcrumbItem[]>([]);
  const [browseItems, setBrowseItems] = useState<SourceFileEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchItems, setSearchItems] = useState<SourceFileEntry[]>([]);
  const [lookupMode, setLookupMode] = useState<SourceLookupMode>(props.source && isSourcePathOnly(props.source.provider) ? "path" : "search");
  const [sortColumn, setSortColumn] = useState<SourcePickerSortColumn>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isAttaching, setIsAttaching] = useState(false);
  const [isDetailsVisible, setIsDetailsVisible] = useState(false);
  const [fileMode, setFileMode] = useState<SourceAttachFileMode>("copy");
  const [pendingGoogleWorkspaceEntries, setPendingGoogleWorkspaceEntries] = useState<SourceFileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const destinationPath = props.destinationPath?.trim() || null;
  const supportsLiveSync = props.source?.supportsLiveSync === true;
  const canUseLiveSync = props.source ? canUseWorkspaceSourceLiveSync(props.source) : false;
  const pathOnlyLookup = props.source ? isSourcePathOnly(props.source.provider) : false;
  const currentFileMode = getSourceAttachFileModeMeta(fileMode);
  const canNavigateUp = (mode === "browse" && (parentFolderId !== null || breadcrumbs[breadcrumbs.length - 2]?.id !== undefined)) && !isLoadingList;
  const LookupIcon = lookupMode === "path" ? FileSearch : Search;

  const visibleSourceItems = mode === "browse" ? browseItems : searchItems;
  const browserEntries = useMemo(
    () => visibleSourceItems.map(toSourceBrowserEntry),
    [visibleSourceItems]
  );
  const sortedEntries = useMemo(
    () => sortSourceBrowserEntries(browserEntries, sortColumn, sortDirection),
    [browserEntries, sortColumn, sortDirection]
  );
  const selectedSourceEntries = useMemo(() => {
    const selectedIdSet = selectedIds;
    return visibleSourceItems.filter((entry) => selectedIdSet.has(entry.id) && (entry.kind === "file" || fileMode === "live_sync"));
  }, [fileMode, selectedIds, visibleSourceItems]);
  const selectedSourceEntry = useMemo(() => {
    if (selectedIds.size !== 1) {
      return null;
    }
    const [selectedId] = selectedIds;
    return visibleSourceItems.find((entry) => entry.id === selectedId) ?? null;
  }, [selectedIds, visibleSourceItems]);
  const allEntriesSelected = browserEntries.length > 0 && selectedIds.size === browserEntries.length;

  const loadBrowse = useCallback(async (
    folderId: string | null,
    nextBreadcrumbs?: SourceBreadcrumbItem[]
  ) => {
    if (!props.workspaceId || !props.source) {
      return;
    }

    setIsLoadingList(true);
    setError(null);
    setStatusText(null);
    setSelectedIds(new Set());
    setLastSelectedIndex(null);

    try {
      const query = new URLSearchParams();
      if (folderId) {
        query.set("folderId", folderId);
      }

      const response = await props.api.get<SourceBrowseResponse>(
        `/api/workspaces/${props.workspaceId}/sources/${props.source.id}/browse${query.toString() ? `?${query.toString()}` : ""}`
      );
      setMode("browse");
      setCurrentFolderId(response.folder.id);
      setCurrentFolderName(response.folder.name);
      setParentFolderId(response.folder.parentId);
      setBrowseItems(response.items);
      setSearchItems([]);

      if (nextBreadcrumbs) {
        setBreadcrumbs(nextBreadcrumbs);
      } else if (!folderId) {
        setBreadcrumbs([{ id: null, name: response.folder.name || props.source.name }]);
      } else {
        setBreadcrumbs((prev) => {
          const index = prev.findIndex((b) => b.id === folderId);
          if (index >= 0) {
            return prev.slice(0, index + 1);
          }
          return [{ id: folderId, name: response.folder.name }];
        });
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoadingList(false);
    }
  }, [props.api, props.source, props.workspaceId]);

  const handleNavigateUp = useCallback(() => {
    const target = breadcrumbs[breadcrumbs.length - 2];
    if (target && target.id !== undefined) {
      void loadBrowse(target.id, breadcrumbs.slice(0, -1));
    } else {
      void loadBrowse(parentFolderId);
    }
  }, [breadcrumbs, loadBrowse, parentFolderId]);

  const handleGoHome = useCallback(() => {
    setSearchQuery("");
    setSortColumn("name");
    setSortDirection("asc");
    void loadBrowse(null);
  }, [loadBrowse]);

  const handleBreadcrumbNavigate = useCallback((folderId: string | null, index?: number) => {
    setSearchQuery("");
    setSortColumn("name");
    setSortDirection("asc");
    const nextBreadcrumbs = index !== undefined ? breadcrumbs.slice(0, index + 1) : undefined;
    void loadBrowse(folderId, nextBreadcrumbs);
  }, [breadcrumbs, loadBrowse]);

  const runLookup = useCallback(async () => {
    if (!props.workspaceId || !props.source) {
      return;
    }

    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) {
      setSortColumn("name");
      setSortDirection("asc");
      await loadBrowse(currentFolderId);
      return;
    }

    setIsLoadingList(true);
    setError(null);
    setStatusText(null);
    setSelectedIds(new Set());
    setLastSelectedIndex(null);

    try {
      const query = new URLSearchParams(lookupMode === "path" ? { path: trimmedQuery } : { q: trimmedQuery });
      if (currentFolderId) {
        query.set("folderId", currentFolderId);
      }

      const response = await props.api.get<SourceSearchResponse | SourcePathResponse>(
        `/api/workspaces/${props.workspaceId}/sources/${props.source.id}/${lookupMode === "path" ? "path" : "search"}?${query.toString()}`
      );
      setMode("search");
      setSearchItems(response.items);
      setSortColumn(lookupMode === "path" ? "name" : "relevance");
      setSortDirection("asc");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setIsLoadingList(false);
    }
  }, [currentFolderId, loadBrowse, lookupMode, props.api, props.source, props.workspaceId, searchQuery]);

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }

    setSortColumn("name");
    setSortDirection("asc");
    setSearchQuery("");
    setLookupMode(props.source && isSourcePathOnly(props.source.provider) ? "path" : "search");
    setIsDetailsVisible(false);
    setFileMode("copy");
    setPendingGoogleWorkspaceEntries(null);
    setBreadcrumbs([]);
    void loadBrowse(null);
  }, [loadBrowse, props.isOpen, props.source?.id]);

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && pendingGoogleWorkspaceEntries === null) {
        props.onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [pendingGoogleWorkspaceEntries, props.isOpen, props.onClose]);

  useEffect(() => {
    if (fileMode === "live_sync" && !canUseLiveSync) {
      setFileMode("copy");
    }
  }, [canUseLiveSync, fileMode]);

  const selectEntryRange = useCallback((targetIndex: number, additive: boolean) => {
    if (lastSelectedIndex === null || targetIndex < 0 || targetIndex >= sortedEntries.length) {
      return;
    }

    const start = Math.min(lastSelectedIndex, targetIndex);
    const end = Math.max(lastSelectedIndex, targetIndex);
    setSelectedIds((current) => {
      const next = additive ? new Set(current) : new Set<string>();
      for (let index = start; index <= end; index += 1) {
        const entry = sortedEntries[index];
        if (entry) {
          next.add(entry.relativePath);
        }
      }
      return next;
    });
  }, [lastSelectedIndex, sortedEntries]);

  const handleEntryClick = useCallback((entry: EnvironmentFileEntry, index: number, event: MouseEvent<HTMLDivElement>) => {
    if (event.shiftKey && lastSelectedIndex !== null) {
      selectEntryRange(index, event.metaKey || event.ctrlKey);
      setLastSelectedIndex(index);
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      setSelectedIds((current) => {
        const next = new Set(current);
        if (next.has(entry.relativePath)) {
          next.delete(entry.relativePath);
        } else {
          next.add(entry.relativePath);
        }
        return next;
      });
      setLastSelectedIndex(index);
      return;
    }

    setSelectedIds(new Set([entry.relativePath]));
    setLastSelectedIndex(index);
  }, [lastSelectedIndex, selectEntryRange]);

  const handleEntryCheckboxClick = useCallback((entry: EnvironmentFileEntry, index: number, event: MouseEvent<HTMLInputElement>) => {
    event.stopPropagation();

    if (event.shiftKey && lastSelectedIndex !== null) {
      selectEntryRange(index, true);
      setLastSelectedIndex(index);
      return;
    }

    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(entry.relativePath)) {
        next.delete(entry.relativePath);
      } else {
        next.add(entry.relativePath);
      }
      return next;
    });
    setLastSelectedIndex(index);
  }, [lastSelectedIndex, selectEntryRange]);

  const handleToggleSelectAll = useCallback(() => {
    if (allEntriesSelected) {
      setSelectedIds(new Set());
      return;
    }

    setSelectedIds(new Set(browserEntries.map((entry) => entry.relativePath)));
  }, [allEntriesSelected, browserEntries]);

  const attachEntries = useCallback(async (
    entries: SourceFileEntry[],
    googleWorkspaceMode: GoogleWorkspaceAttachmentMode
  ) => {
    if (!props.workspaceId || !(props.projectId ?? props.environmentId) || !props.source) {
      return;
    }
    setIsAttaching(true);
    setError(null);
    setStatusText(null);
    const directEntries = new Set(getDirectGoogleWorkspaceEntries({
      source: props.source,
      entries
    }).map((entry) => entry.id));
    const uploadedFiles: WorkspaceSourceAttachResponse[] = [];
    let failedEntry: SourceFileEntry | null = null;
    let failureMessage: string | null = null;
    try {
      for (const sourceEntry of entries) {
        try {
          uploadedFiles.push(await props.api.post<WorkspaceSourceAttachResponse>(
            `/api/workspaces/${props.workspaceId}/sources/${props.source.id}/attach`,
            {
              environmentId: props.projectId ?? props.environmentId,
              taskId: props.taskId ?? undefined,
              itemId: sourceEntry.id,
              fileMode,
              googleWorkspaceMode: googleWorkspaceMode === "direct" && directEntries.has(sourceEntry.id)
                ? "direct"
                : "office",
              destinationPath,
              createDirectories: props.createDirectories === true
            }
          ));
        } catch (attachError) {
          failedEntry = sourceEntry;
          failureMessage = attachError instanceof Error ? attachError.message : String(attachError);
          break;
        }
      }

      if (uploadedFiles.length > 0) {
        props.onSelect(uploadedFiles.map((response) => (
          toTaskAttachmentFromSourceAttachment(response.attachment, props.toAttachmentPath)
        )));
        const attachedIds = new Set(entries.slice(0, uploadedFiles.length).map((entry) => entry.id));
        setSelectedIds((current) => new Set(Array.from(current).filter((id) => !attachedIds.has(id))));
      }

      if (failedEntry) {
        setError(
          `${uploadedFiles.length > 0 ? `Attached ${uploadedFiles.length} item${uploadedFiles.length === 1 ? "" : "s"}. ` : ""}`
          + `Could not attach ${failedEntry.name}: ${failureMessage ?? "The source attachment failed."}`
        );
        return;
      }

      props.onClose();
    } finally {
      setIsAttaching(false);
    }
  }, [destinationPath, fileMode, props]);

  const requestAttach = useCallback((entries: SourceFileEntry[]) => {
    if (!destinationPath) {
      setError(TASK_FILE_DESTINATION_PENDING_MESSAGE);
      return;
    }
    if (getDirectGoogleWorkspaceEntries({ source: props.source, entries }).length > 0) {
      setPendingGoogleWorkspaceEntries(entries);
      return;
    }
    void attachEntries(entries, "office");
  }, [attachEntries, destinationPath, props.source]);

  const handleEntryDoubleClick = useCallback((entry: EnvironmentFileEntry) => {
    const sourceEntry = visibleSourceItems.find((candidate) => candidate.id === entry.relativePath);
    if (!sourceEntry) {
      return;
    }

    if (sourceEntry.kind === "folder") {
      setSearchQuery("");
      setSortColumn("name");
      setSortDirection("asc");
      let nextBreadcrumbs: SourceBreadcrumbItem[] = mode === "browse"
        ? [...breadcrumbs, { id: sourceEntry.id, name: sourceEntry.name }]
        : [{ id: sourceEntry.id, name: sourceEntry.name }];
      if (mode === "search" && sourceEntry.displayPath) {
        const segments = sourceEntry.displayPath.split("/").map((s) => s.trim()).filter(Boolean);
        if (segments.length > 1) {
          nextBreadcrumbs = [
            ...segments.slice(0, -1).map((name) => ({ name })),
            { id: sourceEntry.id, name: sourceEntry.name }
          ];
        }
      }
      void loadBrowse(sourceEntry.id, nextBreadcrumbs);
      return;
    }

    if (sourceEntry.kind === "file") {
      requestAttach([sourceEntry]);
    }
  }, [breadcrumbs, loadBrowse, mode, requestAttach, visibleSourceItems]);

  const handleSortToggle = useCallback((column: FileSortColumn) => {
    setSortColumn((currentColumn) => {
      if (currentColumn === column) {
        setSortDirection((currentDirection) => currentDirection === "asc" ? "desc" : "asc");
        return currentColumn;
      }

      setSortDirection("asc");
      return column;
    });
  }, []);

  const renderSortIndicator = useCallback((column: FileSortColumn): string => {
    if (sortColumn !== column) {
      return "↕";
    }

    return sortDirection === "asc" ? "↑" : "↓";
  }, [sortColumn, sortDirection]);

  const handleSearchSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runLookup();
  }, [runLookup]);

  const handleLookupModeToggle = useCallback(() => {
    if (!props.source || isSourcePathOnly(props.source.provider)) {
      return;
    }
    setLookupMode((current) => current === "search" ? "path" : "search");
    setSearchQuery("");
    setSortColumn("name");
    setSortDirection("asc");
    if (mode === "search") {
      void loadBrowse(currentFolderId);
    }
  }, [currentFolderId, loadBrowse, mode, props.source]);

  const handleAttachSelected = useCallback(() => {
    if (!props.workspaceId || !(props.projectId ?? props.environmentId) || !props.source || selectedSourceEntries.length === 0) {
      return;
    }
    requestAttach(selectedSourceEntries);
  }, [props.environmentId, props.projectId, props.source, props.workspaceId, requestAttach, selectedSourceEntries]);

  if (!props.isOpen || !props.source) {
    return null;
  }

  return (
    <div className="environment-file-picker-overlay" onClick={props.onClose}>
      <div
        className="environment-file-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Choose files from ${props.source.name}`}
        onClick={(event) => event.stopPropagation()}
      >
        {pendingGoogleWorkspaceEntries ? (
          <GoogleWorkspaceAttachmentModeDialog
            fileCount={getDirectGoogleWorkspaceEntries({
              source: props.source,
              entries: pendingGoogleWorkspaceEntries
            }).length}
            fileMode={fileMode}
            canAttachDirectly={props.source.connection.canWrite}
            onChoose={(googleWorkspaceMode) => {
              const entries = pendingGoogleWorkspaceEntries;
              setPendingGoogleWorkspaceEntries(null);
              void attachEntries(entries, googleWorkspaceMode);
            }}
            onCancel={() => setPendingGoogleWorkspaceEntries(null)}
          />
        ) : null}
        <div className="environment-file-picker-body source-file-picker-body">
          <article className="section-card files-layout-card environment-file-picker-card">
            <div className="section-head files-toolbar environment-file-picker-toolbar source-file-picker-toolbar">
              <div className="files-toolbar-left source-file-picker-nav">
                <button
                  className="btn ghost icon-btn"
                  type="button"
                  disabled={!canNavigateUp}
                  onClick={handleNavigateUp}
                  title="Up"
                >
                  <ArrowUp size={18} />
                </button>
                <button
                  className="btn ghost icon-btn"
                  type="button"
                  disabled={isLoadingList}
                  onClick={handleGoHome}
                  title="Source root"
                >
                  <Home size={18} />
                </button>
                <div className="files-toolbar-divider" />
                <div className="muted-text source-file-picker-location">
                  {mode === "browse"
                    ? currentFolderName
                    : lookupMode === "path"
                      ? "Path result"
                      : `Search results in ${currentFolderName}${sortColumn === "relevance" ? " · sorted by relevance" : ""}`}
                </div>
              </div>

              <div className="files-toolbar-actions row-actions source-file-picker-actions">
                <form onSubmit={handleSearchSubmit} className="source-file-picker-search-form">
                  <div className="chat-tools-search source-file-picker-search" role="search">
                    <button
                      type="button"
                      className={`source-file-picker-lookup-mode-button${lookupMode === "path" ? " active" : ""}`}
                      onClick={handleLookupModeToggle}
                      disabled={pathOnlyLookup}
                      title={getSourceLookupModeTitle(props.source.provider, lookupMode)}
                      aria-label={getSourceLookupModeTitle(props.source.provider, lookupMode)}
                      aria-pressed={lookupMode === "path"}
                    >
                      <LookupIcon size={14} />
                    </button>
                    <input
                      type="text"
                      className="chat-tools-search-input"
                      placeholder={getSourceLookupPlaceholder(props.source.provider, lookupMode)}
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      aria-label={getSourceLookupAriaLabel(props.source.provider, lookupMode)}
                    />
                    {searchQuery ? (
                      <button
                        type="button"
                        className="chat-tools-search-clear"
                        onClick={() => {
                          setSearchQuery("");
                          setSortColumn("name");
                          setSortDirection("asc");
                          void loadBrowse(currentFolderId);
                        }}
                        aria-label="Clear source search"
                      >
                        <X size={13} />
                      </button>
                    ) : null}
                  </div>
                  <button type="submit" className="btn ghost" disabled={isLoadingList}>
                    {lookupMode === "path" ? "Find path" : "Search"}
                  </button>
                  {mode === "search" ? (
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        setSearchQuery("");
                        setSortColumn("name");
                        setSortDirection("asc");
                        void loadBrowse(currentFolderId);
                      }}
                      disabled={isLoadingList}
                    >
                      Browse
                    </button>
                  ) : null}
                </form>
                {supportsLiveSync ? (
                  <label
                    className="source-file-picker-mode-field"
                    title={canUseLiveSync ? `Choose how the selected ${props.source.name} file should be attached` : `Reconnect ${props.source.name} with write access to enable live sync`}
                  >
                    <span className="source-file-picker-mode-label">Mode</span>
                    <div className="source-file-picker-mode-control">
                      <currentFileMode.Icon size={14} className="source-file-picker-mode-icon" />
                      <select
                        value={fileMode}
                        onChange={(event) => setFileMode(event.target.value as SourceAttachFileMode)}
                        disabled={isAttaching}
                        aria-label="Attachment mode"
                      >
                        <option value="copy">Copy</option>
                        <option value="live_sync" disabled={!canUseLiveSync}>
                          Live sync
                        </option>
                      </select>
                    </div>
                  </label>
                ) : null}
                <button
                  type="button"
                  className={`icon-btn-subtle${isDetailsVisible ? " active" : ""}`}
                  onClick={() => setIsDetailsVisible((current) => !current)}
                  title={isDetailsVisible ? "Hide details" : "Show details"}
                  aria-label={isDetailsVisible ? "Hide source details" : "Show source details"}
                  aria-pressed={isDetailsVisible}
                >
                  <Info size={15} />
                </button>
                <button
                  type="button"
                  className="icon-btn-subtle"
                  onClick={props.onClose}
                  title="Close"
                  aria-label="Close"
                >
                  <X size={15} />
                </button>
              </div>
            </div>

            <SourceFilePickerPathRibbon
              sourceName={props.source.name}
              mode={mode}
              breadcrumbs={breadcrumbs}
              selectedEntry={selectedSourceEntry}
              selectedCount={selectedIds.size}
              searchQuery={searchQuery}
              onNavigateToFolder={handleBreadcrumbNavigate}
            />

            <div className="files-main environment-file-picker-main">
              <FileBrowserEntries
                isLoadingList={isLoadingList}
                entries={browserEntries}
                sortedEntries={sortedEntries}
                viewMode="list"
                selectedPaths={selectedIds}
                allEntriesSelected={allEntriesSelected}
                onToggleSelectAll={handleToggleSelectAll}
                onSortToggle={handleSortToggle}
                renderSortIndicator={renderSortIndicator}
                onEntryClick={handleEntryClick}
                onEntryDoubleClick={handleEntryDoubleClick}
                onContextMenu={(event) => {
                  event.preventDefault();
                }}
                onCheckboxClick={handleEntryCheckboxClick}
              />

              {isDetailsVisible ? (
                <aside className="file-preview-pane source-file-picker-preview-pane">
                  <div className="source-file-picker-preview-header">
                    <strong>Details</strong>
                  </div>

                  <div className="source-file-picker-preview-grid">
                    <div className="source-file-picker-preview-item">
                      <span className="source-file-picker-preview-label">Source</span>
                      <span
                        className="source-file-picker-preview-value source-file-picker-preview-value-inline"
                        title={props.source.connection.accountLabel?.trim() || props.source.name}
                      >
                        <Link2 size={14} />
                        <span>{props.source.connection.accountLabel?.trim() || props.source.name}</span>
                      </span>
                    </div>

                    <div className="source-file-picker-preview-item">
                      <span className="source-file-picker-preview-label">Mode</span>
                      <span className="source-file-picker-preview-value">
                        {fileMode === "live_sync"
                          ? "Live sync working copy"
                          : mode === "browse"
                            ? "Copy import (browse)"
                            : lookupMode === "path"
                              ? "Copy import (path)"
                              : "Copy import (search)"}
                      </span>
                    </div>

                    <div className="source-file-picker-preview-item">
                      <span className="source-file-picker-preview-label">Selection</span>
                      <span className="source-file-picker-preview-value">
                        {describeSourceSelection(selectedSourceEntries.length, fileMode)}
                      </span>
                    </div>

                    {mode === "browse" ? (
                      <div className="source-file-picker-preview-item">
                        <span className="source-file-picker-preview-label">Folder</span>
                        <span className="source-file-picker-preview-value" title={currentFolderName}>
                          {currentFolderName}
                        </span>
                      </div>
                    ) : null}
                  </div>
                  {supportsLiveSync ? (
                    <div className="muted-text" style={{ fontSize: "0.78rem", lineHeight: 1.45 }}>
                      {canUseLiveSync
                        ? fileMode === "live_sync"
                          ? `Live sync keeps the imported file linked to the same ${props.source.name} item so you or the agent can pull and push changes later.`
                          : `Copy mode imports a static snapshot. Switch to Live sync if you want pull/push updates with the same ${props.source.name} file.`
                        : `This ${props.source.name} connection is currently read-only. Reconnect it with write access to enable Live sync.`}
                    </div>
                  ) : null}
                </aside>
              ) : null}
            </div>
          </article>
        </div>

        <div className="environment-file-picker-footer">
          <div className="environment-file-picker-status-group">
            {error ? <p className="error-text environment-file-picker-status">{error}</p> : null}
            {!error && statusText ? <p className="muted-text environment-file-picker-status">{statusText}</p> : null}
            {!error && !statusText ? (
              <p className="muted-text environment-file-picker-status">
                Double-click a folder to browse, or attach the selected {fileMode === "live_sync" ? "items as live sync links" : "files"}.
              </p>
            ) : null}
          </div>
          <div className="row-actions">
            <button type="button" className="btn ghost" onClick={props.onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={selectedSourceEntries.length === 0 || isAttaching}
              onClick={() => {
                void handleAttachSelected();
              }}
            >
              {isAttaching
                ? (fileMode === "live_sync" ? "Linking..." : "Importing...")
                : (fileMode === "live_sync" ? "Attach selected (Live)" : "Attach selected")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
