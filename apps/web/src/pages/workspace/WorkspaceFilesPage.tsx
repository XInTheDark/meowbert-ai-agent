import { useState, useRef, useCallback, useEffect, useMemo, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowUp,
  Download,
  Home,
  Loader2
} from "lucide-react";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import {
  type EnvironmentFileEntry,
  type EnvironmentFileListResponse,
  type EnvironmentFilePreview,
  type FileDeleteResponse,
  type StorageSummary,
  type StorageSummaryResponse
} from "../../lib/types";
import { triggerAuthenticatedBrowserDownload } from "../../lib/authenticated-download";
import { buildWorkspaceBatchDownloadUrl, buildWorkspaceDownloadUrl, formatBytes } from "../../lib/utils";
import {
  normalizeEnvironmentPathInput,
  sortEnvironmentFileEntries,
  type FileSortColumn
} from "../../environment/environmentFiles";
import {
  buildViewerUploadQuery,
  planViewerUploads,
  selectionIncludesFolder
} from "../../environment/fileUploadPlanning";
import { FileViewerUploadMenu } from "../../components/files/FileViewerUploadMenu";
import { EnvironmentFileBrowser } from "../environment/files/EnvironmentFileBrowser";
import { EnvironmentFilesPreviewPane } from "../environment/files/EnvironmentFilesPreviewPane";

export function WorkspaceFilesPage() {
  const { api, token, activeWorkspaceId, environments, setFlash } = useWorkspaceApp();
  const { platform, capabilities } = useAppRuntime();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialPathFromUrl = searchParams.get("path") ?? "";
  const [cwd, setCwd] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<EnvironmentFileEntry[]>([]);
  const [pathInput, setPathInput] = useState("/");
  const [sortColumn, setSortColumn] = useState<FileSortColumn>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [filePreview, setFilePreview] = useState<EnvironmentFilePreview | null>(null);
  const [storageSummary, setStorageSummary] = useState<StorageSummary | null>(null);
  const [storageSummaryStatus, setStorageSummaryStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [isStorageExpanded, setIsStorageExpanded] = useState(false);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const latestStorageRequestRef = useRef(0);
  const scopeQuery = cwd ? `?path=${encodeURIComponent(cwd)}` : "";
  const setFolderInputElement = useCallback((node: HTMLInputElement | null) => {
    folderInputRef.current = node;
    if (!node) {
      return;
    }

    node.setAttribute("webkitdirectory", "");
    node.setAttribute("directory", "");
  }, []);

  const loadStorageSummary = useCallback(async () => {
    if (!activeWorkspaceId) {
      return;
    }

    const requestId = latestStorageRequestRef.current + 1;
    latestStorageRequestRef.current = requestId;
    setStorageSummaryStatus("loading");

    try {
      const response = await api.get<StorageSummaryResponse>(`/api/workspaces/${activeWorkspaceId}/files/storage`);
      if (latestStorageRequestRef.current !== requestId) {
        return;
      }
      setStorageSummary(response.storage);
      setStorageSummaryStatus("ready");
    } catch {
      if (latestStorageRequestRef.current !== requestId) {
        return;
      }
      setStorageSummary(null);
      setStorageSummaryStatus("error");
    }
  }, [activeWorkspaceId, api]);

  const loadFiles = useCallback(async (nextPath?: string) => {
    if (!activeWorkspaceId) {
      return;
    }

    setIsLoadingList(true);
    setError(null);
    setSelectedPaths(new Set());
    setFilePreview(null);

    try {
      const queryPath = nextPath || "";
      const response = await api.get<EnvironmentFileListResponse>(
        `/api/workspaces/${activeWorkspaceId}/files?path=${encodeURIComponent(queryPath)}`
      );
      setCwd(response.cwd);
      setParentPath(response.parentPath);
      setEntries(response.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingList(false);
    }
  }, [activeWorkspaceId, api]);

  const loadPreview = useCallback(async (relativePath: string) => {
    if (!activeWorkspaceId) {
      return;
    }

    setIsLoadingPreview(true);
    setError(null);
    try {
      const preview = await api.get<EnvironmentFilePreview>(
        `/api/workspaces/${activeWorkspaceId}/files/content?path=${encodeURIComponent(relativePath)}`
      );
      setFilePreview(preview);
    } catch {
      setFilePreview(null);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [activeWorkspaceId, api]);

  useEffect(() => {
    setSelectedPaths(new Set());
    setFilePreview(null);
    setStorageSummary(null);
    setStorageSummaryStatus("idle");
    setIsStorageExpanded(false);
    setIsUploadMenuOpen(false);
    setError(null);
    void loadFiles(initialPathFromUrl);
  }, [activeWorkspaceId, initialPathFromUrl, loadFiles]);

  useEffect(() => {
    if (selectedPaths.size !== 1) {
      setFilePreview(null);
      return;
    }

    const relativePath = [...selectedPaths][0];
    const entry = entries.find((item) => item.relativePath === relativePath);
    if (entry?.kind === "file") {
      void loadPreview(relativePath);
    } else {
      setFilePreview(null);
    }
  }, [entries, loadPreview, selectedPaths]);

  useEffect(() => {
    setPathInput(`/${cwd}`);
  }, [cwd]);

  const uploadFiles = useCallback(async (files: FileList | File[] | null): Promise<void> => {
    if (!activeWorkspaceId) {
      return;
    }

    const uploadPlans = planViewerUploads(cwd, files);
    if (uploadPlans.length === 0) {
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      for (const upload of uploadPlans) {
        const formData = new FormData();
        formData.append("file", upload.file);

        try {
          await api.postForm(
            `/api/workspaces/${activeWorkspaceId}/files/upload${buildViewerUploadQuery(upload)}`,
            formData
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Failed to upload ${upload.label}: ${message}`);
        }
      }

      if (storageSummaryStatus === "ready") {
        await Promise.all([loadFiles(cwd), loadStorageSummary()]);
      } else {
        await loadFiles(cwd);
      }

      setFlash({
        tone: "success",
        text: selectionIncludesFolder(uploadPlans)
          ? "Folder uploaded."
          : uploadPlans.length === 1
            ? "File uploaded."
            : `${uploadPlans.length} files uploaded.`
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      if (folderInputRef.current) {
        folderInputRef.current.value = "";
      }
    }
  }, [activeWorkspaceId, api, cwd, loadFiles, loadStorageSummary, setFlash, storageSummaryStatus]);

  const sortedEntries = useMemo(
    () => sortEnvironmentFileEntries(entries, sortColumn, sortDirection),
    [entries, sortColumn, sortDirection]
  );
  const selectedRelativePaths = sortedEntries
    .filter((entry) => selectedPaths.has(entry.relativePath))
    .map((entry) => entry.relativePath);
  const allEntriesSelected = sortedEntries.length > 0 && selectedRelativePaths.length === sortedEntries.length;
  const storageUsedBytes = storageSummary?.usedBytes ?? 0;
  const storageLimitBytes =
    storageSummary && typeof storageSummary.limitBytes === "number" ? storageSummary.limitBytes : null;
  const storageUsageRawPercent =
    storageSummary && typeof storageSummary.usagePercent === "number" ? storageSummary.usagePercent : null;
  const hasStorageLimit = storageLimitBytes !== null && storageLimitBytes > 0;
  const storageUsagePercent = storageUsageRawPercent !== null ? Math.round(storageUsageRawPercent) : null;
  const storageMeterPercent =
    storageUsageRawPercent !== null
      ? Math.max(0, Math.min(100, Math.round(storageUsageRawPercent)))
      : 0;
  const storageRemainingBytes = hasStorageLimit ? storageLimitBytes - storageUsedBytes : null;
  const storageLabel = hasStorageLimit
    ? (storageUsagePercent !== null ? String(storageUsagePercent) + "% " : "--") + "used (" + formatBytes(storageUsedBytes) + " / " + formatBytes(storageLimitBytes) + ")"
    : storageSummary
      ? "Used " + formatBytes(storageUsedBytes) + " (no limit)"
      : "Storage unavailable";
  const storageUsageToneStyle = storageSummary?.isOverLimit
    ? {
        color: "var(--danger)",
        borderColor: "color-mix(in srgb, var(--danger) 55%, var(--border))"
      }
    : undefined;
  const storageMeterFillStyle = storageSummary?.isOverLimit
    ? { background: "color-mix(in srgb, var(--danger) 72%, var(--warning))" }
    : undefined;
  const storageTooltip = hasStorageLimit
    ? [
        `Storage ${formatBytes(storageUsedBytes)} / ${formatBytes(storageLimitBytes)}`,
        storageUsagePercent !== null ? `${storageUsagePercent}% used` : null,
        storageRemainingBytes !== null
          ? storageRemainingBytes >= 0
            ? `${formatBytes(storageRemainingBytes)} free`
            : `${formatBytes(Math.abs(storageRemainingBytes))} over limit`
          : null
      ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0).join(" • ")
    : storageLabel;

  const handleStorageSummaryRequest = useCallback(() => {
    if (storageSummaryStatus === "loading") {
      return;
    }

    setIsStorageExpanded(true);
    void loadStorageSummary();
  }, [loadStorageSummary, storageSummaryStatus]);

  async function deletePaths(paths: string[]): Promise<void> {
    if (activeWorkspaceId == null || paths.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      paths.length === 1
        ? "Delete " + paths[0] + " permanently? This cannot be undone."
        : "Delete " + String(paths.length) + " selected item(s) permanently? This cannot be undone."
    );
    if (confirmed !== true) {
      return;
    }

    setError(null);
    try {
      const result = await api.post<FileDeleteResponse>(
        "/api/workspaces/" + activeWorkspaceId + "/files/delete",
        { paths }
      );
      setStorageSummary(result.storage);
      setStorageSummaryStatus("ready");
      await loadFiles(cwd);
      setFlash({
        tone: "success",
        text: result.deletedCount === 1 ? "Deleted 1 item." : "Deleted " + String(result.deletedCount) + " items."
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const triggerDownload = useCallback(async (paths: string[]): Promise<void> => {
    if (!activeWorkspaceId || paths.length === 0 || isDownloading) {
      return;
    }

    const url = paths.length === 1
      ? buildWorkspaceDownloadUrl(activeWorkspaceId, paths[0])
      : buildWorkspaceBatchDownloadUrl(activeWorkspaceId, paths, cwd);
    const suggestedFilename = paths.length === 1
      ? paths[0].split("/").pop() ?? "download"
      : `workspace-files-${Date.now()}.zip`;

    setIsDownloading(true);
    setError(null);
    try {
      if (capabilities.supportsNativeDownloads) {
        const result = await platform.saveUrlToFile({ url, token, suggestedFilename });
        if (!result.canceled) {
          setFlash({ tone: "success", text: paths.length === 1 ? "File saved." : "Archive saved." });
        }
        return;
      }

      await triggerAuthenticatedBrowserDownload({
        url,
        token,
        suggestedFilename
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDownloading(false);
    }
  }, [activeWorkspaceId, capabilities.supportsNativeDownloads, cwd, isDownloading, platform, setFlash, token]);

  const handleFileUploadPicker = useCallback(async (): Promise<void> => {
    if (isUploading) {
      return;
    }

    setIsUploadMenuOpen(false);

    if (capabilities.supportsNativeFileDialogs) {
      const files = await platform.pickFiles();
      if (files.length > 0) {
        await uploadFiles(files);
      }
      return;
    }

    fileInputRef.current?.click();
  }, [capabilities.supportsNativeFileDialogs, isUploading, platform, uploadFiles]);

  const handleFolderUploadPicker = useCallback((): void => {
    if (isUploading) {
      return;
    }

    setIsUploadMenuOpen(false);
    folderInputRef.current?.click();
  }, [isUploading]);

  const handlePathSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadFiles(normalizeEnvironmentPathInput(pathInput));
  };

  const handleScopeChange = (target: string) => {
    if (!activeWorkspaceId) {
      return;
    }
    if (target === "workspace") {
      return;
    }
    navigate(`/app/${activeWorkspaceId}/projects/${target}/files${scopeQuery}`);
  };

  const handleSortToggle = (column: FileSortColumn): void => {
    setSortColumn((currentColumn) => {
      if (currentColumn === column) {
        setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
        return currentColumn;
      }

      setSortDirection("asc");
      return column;
    });
  };

  const renderSortIndicator = (column: FileSortColumn): string => {
    if (sortColumn !== column) {
      return "↕";
    }

    return sortDirection === "asc" ? "↑" : "↓";
  };

  const handleToggleSelectAll = () => {
    if (allEntriesSelected) {
      setSelectedPaths(new Set());
      return;
    }
    setSelectedPaths(new Set(sortedEntries.map((entry) => entry.relativePath)));
  };

  if (!activeWorkspaceId) {
    return (
      <section className="page-content">
        <article className="section-card empty-card">
          <h3>No workspace selected</h3>
          <p>Select a workspace to browse files.</p>
        </article>
      </section>
    );
  }

  return (
    <section className="page-content" onClick={() => setIsUploadMenuOpen(false)}>
      <article className="section-card files-layout-card">
        <div className="section-head files-toolbar">
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
            <button className="btn ghost icon-btn" type="button" disabled={isLoadingList} onClick={() => void loadFiles("")} title="Root">
              <Home size={18} />
            </button>
            <div className="files-toolbar-divider" />
            <form className="files-path-form" onSubmit={handlePathSubmit}>
              <input
                className="files-path-input"
                value={pathInput}
                onChange={(event) => setPathInput(event.target.value)}
                placeholder="/"
                spellCheck={false}
                aria-label="Path"
                disabled={isLoadingList}
              />
              <select
                className="files-scope-select icon-only"
                value="workspace"
                onChange={(event) => handleScopeChange(event.target.value)}
                aria-label="File scope"
                disabled={isLoadingList}
              >
                <option value="workspace">Workspace</option>
                {environments.map((environment) => (
                  <option key={environment.id} value={environment.id}>
                    {environment.name}
                  </option>
                ))}
              </select>
            </form>
          </div>

          <div className="row-actions files-toolbar-actions">
            <span className="muted-text" style={{ fontSize: "0.83rem" }}>
              {selectedRelativePaths.length > 0 ? `${selectedRelativePaths.length} selected` : "No selection"}
            </span>
            {storageSummaryStatus === "loading" ? (
              <span
                className="context-usage-pill"
                style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "2.5rem" }}
                title="Checking storage..."
                aria-label="Checking storage"
              >
                <Loader2 className="spin" size={14} />
              </span>
            ) : storageSummaryStatus !== "ready" ? (
              <button
                className={`context-usage-pill ${storageSummaryStatus === "error" ? "warning" : ""}`}
                type="button"
                onClick={handleStorageSummaryRequest}
                title={storageSummaryStatus === "error" ? "Retry storage summary" : "Load storage summary"}
                aria-label={storageSummaryStatus === "error" ? "Retry storage summary" : "Load storage summary"}
              >
                ?%
              </button>
            ) : hasStorageLimit && storageUsagePercent !== null ? (
              isStorageExpanded ? (
                <div
                  className={`context-usage-chip ${storageUsagePercent >= 80 || storageSummary?.isOverLimit ? "warning" : ""}`}
                  onClick={() => setIsStorageExpanded(false)}
                  style={{ cursor: "pointer", ...(storageUsageToneStyle ?? {}) }}
                  title="Click to collapse"
                >
                  <div className="context-usage-label">
                    Storage {formatBytes(storageUsedBytes)} / {formatBytes(storageLimitBytes)} ({storageUsagePercent}%)
                  </div>
                  {storageRemainingBytes !== null ? (
                    <div
                      className="muted-text"
                      style={{ fontSize: "0.75rem", color: storageSummary?.isOverLimit ? "var(--danger)" : undefined }}
                    >
                      {storageRemainingBytes >= 0
                        ? `${formatBytes(storageRemainingBytes)} free`
                        : `${formatBytes(Math.abs(storageRemainingBytes))} over limit`}
                    </div>
                  ) : null}
                  <div className="context-usage-meter">
                    <span style={{ width: `${storageMeterPercent}%`, ...(storageMeterFillStyle ?? {}) }} />
                  </div>
                </div>
              ) : (
                <button
                  className={`context-usage-pill ${storageUsagePercent >= 80 || storageSummary?.isOverLimit ? "warning" : ""}`}
                  type="button"
                  onClick={() => setIsStorageExpanded(true)}
                  title={storageTooltip}
                  style={storageUsageToneStyle}
                >
                  {storageUsagePercent}%
                </button>
              )
            ) : (
              <span
                className="muted-text"
                style={{
                  fontSize: "0.78rem",
                  color: storageSummary?.isOverLimit ? "var(--danger)" : undefined,
                  maxWidth: "20rem",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                }}
                title={storageLabel}
              >
                {storageLabel}
              </span>
            )}
            <button
              className="btn ghost"
              type="button"
              disabled={selectedRelativePaths.length === 0 || isDownloading}
              onClick={() => void triggerDownload(selectedRelativePaths)}
              title={
                isDownloading
                  ? "Preparing download..."
                  : selectedRelativePaths.length > 1
                    ? `Download ${selectedRelativePaths.length} selected`
                    : "Download selected"
              }
              aria-label={isDownloading ? "Preparing download" : "Download selected"}
            >
              {isDownloading ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
            </button>
            <button className="btn ghost danger-outline" type="button" disabled={selectedRelativePaths.length === 0} onClick={() => void deletePaths(selectedRelativePaths)}>
              Delete
            </button>
            <FileViewerUploadMenu
              isOpen={isUploadMenuOpen}
              isUploading={isUploading}
              onToggle={() => setIsUploadMenuOpen((current) => !current)}
              onUploadFiles={() => {
                void handleFileUploadPicker();
              }}
              onUploadFolder={handleFolderUploadPicker}
            />
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          hidden
          multiple
          onChange={(event) => {
            const files = event.target.files ? Array.from(event.target.files) : [];
            event.target.value = "";
            void uploadFiles(files);
          }}
        />
        <input
          ref={setFolderInputElement}
          type="file"
          hidden
          multiple
          onChange={(event) => {
            const files = event.target.files ? Array.from(event.target.files) : [];
            event.target.value = "";
            void uploadFiles(files);
          }}
        />

        <div className="files-main">
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
            onEntryClick={(entry) => setSelectedPaths(new Set([entry.relativePath]))}
            onEntryDoubleClick={(entry) => {
              if (entry.kind === "directory") {
                void loadFiles(entry.relativePath);
              }
            }}
            onContextMenu={(event) => event.preventDefault()}
            onCheckboxClick={(entry, _index, event) => {
              event.stopPropagation();
              setSelectedPaths((current) => {
                const next = new Set(current);
                if (next.has(entry.relativePath)) {
                  next.delete(entry.relativePath);
                } else {
                  next.add(entry.relativePath);
                }
                return next;
              });
            }}
          />

          <EnvironmentFilesPreviewPane
            selectedEntry={selectedPaths.size === 1
              ? sortedEntries.find((entry) => selectedPaths.has(entry.relativePath)) ?? null
              : null}
            filePreview={filePreview}
            selectedCount={selectedPaths.size}
            isLoadingPreview={isLoadingPreview}
            isDownloading={isDownloading}
            previewDownloadUrl={
              activeWorkspaceId && selectedPaths.size === 1
                ? buildWorkspaceDownloadUrl(activeWorkspaceId, [...selectedPaths][0])
                : null
            }
            previewToken={token}
            liveSyncStatus={null}
            isLiveSyncStatusLoading={false}
            isLiveSyncMutating={false}
            onDownload={(relativePath) => {
              void triggerDownload([relativePath]);
            }}
            onClose={() => {
              setSelectedPaths(new Set());
              setFilePreview(null);
            }}
          />
        </div>

        {error ? <div className="error-banner" style={{ borderRadius: 0 }}>{error}</div> : null}
      </article>
    </section>
  );
}
