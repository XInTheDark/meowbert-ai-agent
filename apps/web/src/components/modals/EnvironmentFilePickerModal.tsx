import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import { ArrowUp, Home, Upload, X } from "lucide-react";
import type { ApiClient } from "../../lib/api";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { buildDownloadUrl } from "../../lib/utils";
import {
  normalizeEnvironmentPathInput,
  sortEnvironmentFileEntries,
  type FileSortColumn
} from "../../environment/environmentFiles";
import type {
  EnvironmentFileEntry,
  EnvironmentFileListResponse,
  EnvironmentFilePreview,
  TaskAttachment
} from "../../lib/types";
import { EnvironmentFileBrowser } from "../../pages/environment/files/EnvironmentFileBrowser";
import { EnvironmentFilesPreviewPane } from "../../pages/environment/files/EnvironmentFilesPreviewPane";

interface UploadedEnvironmentFilePayload {
  file: {
    relativePath: string;
  };
}

interface EnvironmentFilePickerModalProps {
  api: ApiClient;
  projectId?: string | null;
  environmentId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSelect: (attachments: TaskAttachment[]) => void;
}

function toTaskAttachment(entry: EnvironmentFileEntry): TaskAttachment {
  return {
    id: crypto.randomUUID(),
    kind: entry.kind === "directory" ? "directory" : "file",
    label: entry.name,
    content: entry.relativePath,
    relativePath: entry.relativePath,
    sizeBytes: entry.sizeBytes
  };
}

export function EnvironmentFilePickerModal(props: EnvironmentFilePickerModalProps) {
  const { token } = useWorkspaceApp();
  const targetEnvironmentId = props.projectId ?? props.environmentId;
  const { platform, capabilities } = useAppRuntime();
  const [cwd, setCwd] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<EnvironmentFileEntry[]>([]);
  const [pathInput, setPathInput] = useState("/");
  const [sortColumn, setSortColumn] = useState<FileSortColumn>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [filePreview, setFilePreview] = useState<EnvironmentFilePreview | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const sortedEntries = useMemo(
    () => sortEnvironmentFileEntries(entries, sortColumn, sortDirection),
    [entries, sortColumn, sortDirection]
  );
  const selectedAttachableEntries = useMemo(
    () => sortedEntries.filter(
      (entry) => selectedPaths.has(entry.relativePath) && (entry.kind === "file" || entry.kind === "directory")
    ),
    [selectedPaths, sortedEntries]
  );
  const selectedEntry = selectedPaths.size === 1
    ? sortedEntries.find((entry) => selectedPaths.has(entry.relativePath)) ?? null
    : null;
  const allEntriesSelected = entries.length > 0 && selectedPaths.size === entries.length;

  const loadFiles = useCallback(async (nextPath: string = "") => {
    if (!targetEnvironmentId) {
      return;
    }

    setIsLoadingList(true);
    setError(null);
    setStatusText(null);
    setSelectedPaths(new Set());
    setLastSelectedIndex(null);
    setFilePreview(null);

    try {
      const query = `?path=${encodeURIComponent(nextPath)}`;
      const response = await props.api.get<EnvironmentFileListResponse>(
        `/api/projects/${targetEnvironmentId}/files${query}`
      );
      setCwd(response.cwd);
      setParentPath(response.parentPath);
      setEntries(response.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingList(false);
    }
  }, [props.api, targetEnvironmentId]);

  const loadPreview = useCallback(async (relativePath: string) => {
    if (!targetEnvironmentId) {
      return;
    }

    setIsLoadingPreview(true);
    try {
      const preview = await props.api.get<EnvironmentFilePreview>(
        `/api/projects/${targetEnvironmentId}/files/content?path=${encodeURIComponent(relativePath)}`
      );
      setFilePreview(preview);
    } catch {
      setFilePreview(null);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [props.api, targetEnvironmentId]);

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }

    setSortColumn("name");
    setSortDirection("asc");
    setError(null);
    setStatusText(null);
    setPathInput("/");
    void loadFiles("");
  }, [loadFiles, props.isOpen, targetEnvironmentId]);

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.isOpen, props.onClose]);

  useEffect(() => {
    setPathInput(`/${cwd}`);
  }, [cwd]);

  useEffect(() => {
    if (!props.isOpen) {
      return;
    }

    if (selectedPaths.size !== 1) {
      setFilePreview(null);
      return;
    }

    const path = Array.from(selectedPaths)[0];
    const entry = entries.find((candidate) => candidate.relativePath === path);
    if (!entry || entry.kind !== "file") {
      setFilePreview(null);
      return;
    }

    void loadPreview(path);
  }, [entries, loadPreview, props.isOpen, selectedPaths]);

  const selectEntryRange = useCallback((targetIndex: number, additive: boolean) => {
    if (lastSelectedIndex === null || targetIndex < 0 || targetIndex >= sortedEntries.length) {
      return;
    }

    const start = Math.min(lastSelectedIndex, targetIndex);
    const end = Math.max(lastSelectedIndex, targetIndex);
    setSelectedPaths((current) => {
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
      setSelectedPaths((current) => {
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

    setSelectedPaths(new Set([entry.relativePath]));
    setLastSelectedIndex(index);
  }, [lastSelectedIndex, selectEntryRange]);

  const handleEntryCheckboxClick = useCallback((entry: EnvironmentFileEntry, index: number, event: MouseEvent<HTMLInputElement>) => {
    event.stopPropagation();

    if (event.shiftKey && lastSelectedIndex !== null) {
      selectEntryRange(index, true);
      setLastSelectedIndex(index);
      return;
    }

    setSelectedPaths((current) => {
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
      setSelectedPaths(new Set());
      return;
    }

    setSelectedPaths(new Set(entries.map((entry) => entry.relativePath)));
  }, [allEntriesSelected, entries]);

  const handleEntryDoubleClick = useCallback((entry: EnvironmentFileEntry) => {
    if (entry.kind === "directory") {
      void loadFiles(entry.relativePath);
      return;
    }

    if (entry.kind === "file") {
      props.onSelect([toTaskAttachment(entry)]);
      props.onClose();
    }
  }, [loadFiles, props]);

  const handlePathSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadFiles(normalizeEnvironmentPathInput(pathInput));
  }, [loadFiles, pathInput]);

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

  const uploadFiles = useCallback(async (files: FileList | File[] | null) => {
    if (!targetEnvironmentId || !files || files.length === 0) {
      return;
    }

    setIsUploading(true);
    setError(null);
    setStatusText(null);

    try {
      const normalizedFiles = Array.from(files);
      const uploadedPaths: string[] = [];

      for (const file of normalizedFiles) {
        const formData = new FormData();
        formData.append("file", file);
        const query = cwd ? `?path=${encodeURIComponent(cwd)}` : "";
        const response = await props.api.postForm<UploadedEnvironmentFilePayload>(
          `/api/projects/${targetEnvironmentId}/files/upload${query}`,
          formData
        );
        uploadedPaths.push(response.file.relativePath);
      }

      await loadFiles(cwd);
      setSelectedPaths(new Set(uploadedPaths));
      setStatusText(normalizedFiles.length === 1 ? "File uploaded to project." : `${normalizedFiles.length} files uploaded to project.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [cwd, loadFiles, props.api, targetEnvironmentId]);

  const handleUploadPicker = useCallback(async () => {
    if (isUploading) {
      return;
    }

    if (capabilities.supportsNativeFileDialogs) {
      const files = await platform.pickFiles();
      if (files.length > 0) {
        await uploadFiles(files);
      }
      return;
    }

    fileInputRef.current?.click();
  }, [capabilities.supportsNativeFileDialogs, isUploading, platform, uploadFiles]);

  if (!props.isOpen) {
    return null;
  }

  return (
    <div className="environment-file-picker-overlay" onClick={props.onClose}>
      <div
        className="environment-file-picker-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="environment-file-picker-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="environment-file-picker-header">
          <div>
            <h2 id="environment-file-picker-title">Project files</h2>
            <p className="environment-file-picker-subtitle">Pick existing files or folders, or upload new files into the project.</p>
          </div>
          <button type="button" className="legal-close" onClick={props.onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="environment-file-picker-body">
          <article className="section-card files-layout-card environment-file-picker-card">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(event) => {
                void uploadFiles(event.target.files);
              }}
            />
            <div className="section-head files-toolbar environment-file-picker-toolbar">
              <div className="files-toolbar-left">
                <button
                  className="btn ghost icon-btn"
                  type="button"
                  disabled={parentPath === null || isLoadingList}
                  onClick={() => void loadFiles(parentPath ?? "")}
                  title="Up"
                >
                  <ArrowUp size={18} />
                </button>
                <button
                  className="btn ghost icon-btn"
                  type="button"
                  disabled={isLoadingList}
                  onClick={() => void loadFiles("")}
                  title="Project root"
                >
                  <Home size={18} />
                </button>
                <div className="files-toolbar-divider" />
                <form className="files-path-form" onSubmit={handlePathSubmit}>
                  <div className="files-path-scroll">
                    <input
                      className="files-path-input"
                      value={pathInput}
                      onChange={(event) => setPathInput(event.target.value)}
                      placeholder="/"
                      aria-label="Current project path"
                    />
                  </div>
                </form>
              </div>
              <div className="files-toolbar-actions row-actions">
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    void handleUploadPicker();
                  }}
                  disabled={isUploading}
                >
                  <Upload size={16} />
                  {isUploading ? "Uploading..." : "Upload here"}
                </button>
              </div>
            </div>

            <div className="files-main environment-file-picker-main">
              <EnvironmentFileBrowser
                isLoadingList={isLoadingList}
                entries={entries}
                sortedEntries={sortedEntries}
                viewMode="list"
                selectedPaths={selectedPaths}
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
              <EnvironmentFilesPreviewPane
                selectedEntry={selectedEntry}
                filePreview={filePreview}
                selectedCount={selectedPaths.size}
                isLoadingPreview={isLoadingPreview}
                previewDownloadUrl={selectedEntry && targetEnvironmentId ? buildDownloadUrl(targetEnvironmentId, selectedEntry.relativePath) : null}
                previewToken={token}
                liveSyncStatus={null}
                isLiveSyncStatusLoading={false}
                isLiveSyncMutating={false}
                onClose={() => setSelectedPaths(new Set())}
              />
            </div>
          </article>
        </div>

        <div className="environment-file-picker-footer">
          <div className="environment-file-picker-status-group">
            {error ? <p className="error-text environment-file-picker-status">{error}</p> : null}
            {!error && statusText ? <p className="muted-text environment-file-picker-status">{statusText}</p> : null}
            {!error && !statusText ? (
              <p className="muted-text environment-file-picker-status">
                {selectedAttachableEntries.length > 0
                  ? `${selectedAttachableEntries.length} item${selectedAttachableEntries.length === 1 ? "" : "s"} selected`
                  : "Select one or more files or folders to attach"}
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
              disabled={selectedAttachableEntries.length === 0}
              onClick={() => {
                props.onSelect(selectedAttachableEntries.map(toTaskAttachment));
                props.onClose();
              }}
            >
              Attach selected
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
