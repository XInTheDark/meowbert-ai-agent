import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import type {
  FileDeleteResponse,
  ProjectFileEntry,
  ProjectFileListResponse,
  ProjectFilePreview,
  TaskAttachment
} from "../../lib/types";
import {
  buildBatchDownloadUrl,
  buildDownloadUrl,
  buildProjectContextPath,
  getProjectContextNotes,
  getProjectJsonPayload,
  normalizeProjectJsonPayload,
  removeProjectContextNotes,
  setProjectContextNote
} from "../../lib/utils";
import { triggerAuthenticatedBrowserDownload } from "../../lib/authenticated-download";
import { planViewerUploads, buildViewerUploadQuery, selectionIncludesFolder } from "../../project/fileUploadPlanning";
import { type FileSortColumn, sortProjectFileEntries } from "../../project/projectFiles";
import { ProjectFileBrowser } from "./files/ProjectFileBrowser";
import { ProjectContextPreviewPane } from "./context/ProjectContextPreviewPane";
import { ProjectContextMenu } from "./context/ProjectContextMenu";
import { ProjectContextNoteModal } from "./context/ProjectContextNoteModal";
import { AttachFilesMenu } from "../../components/files/AttachFilesMenu";
import { CreateTextFileModal } from "../../components/files/CreateTextFileModal";
import { SourceFilePickerModal } from "../../components/modals/SourceFilePickerModal";
import { Grid, List as ListIcon, ArrowUp, Home, Trash2 } from "lucide-react";
import {
  canAttachWorkspaceSource,
  type WorkspaceSourceListResponse,
  type WorkspaceSourceSummary
} from "../../sources/sourceTypes";

function stripContextPrefix(relativePath: string | null | undefined): string {
  if (!relativePath) {
    return "";
  }

  if (relativePath === "context") {
    return "";
  }

  return relativePath.startsWith("context/") ? relativePath.slice("context/".length) : relativePath;
}

function buildContextSourceNoteFilename(label: string, index: number): string {
  const fallback = `source-note-${index + 1}.txt`;
  const basename = label.trim().split(/[\\/]/).pop() ?? "";
  const sanitized = basename
    .replace(/[<>:"|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "");

  if (!sanitized) {
    return fallback;
  }

  return /\.[A-Za-z0-9]{1,10}$/.test(sanitized) ? sanitized : `${sanitized}.txt`;
}

export function ProjectContextPage() {
  const workspaceApp = useWorkspaceApp();
  const { api, token, setFlash, activeWorkspaceId } = workspaceApp;
  const activeProjectId = workspaceApp.activeProjectId ?? workspaceApp.activeEnvironmentId;
  const projects = workspaceApp.projects ?? workspaceApp.environments;
  const patchProject = workspaceApp.patchProject ?? workspaceApp.patchEnvironment;
  const { platform, capabilities } = useAppRuntime();
  const project = projects.find((item) => item.id === activeProjectId) ?? null;
  const projectPayload = useMemo(() => getProjectJsonPayload(project), [project]);
  const contextNotes = useMemo(() => getProjectContextNotes(projectPayload), [projectPayload]);

  const [cwd, setCwd] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<ProjectFileEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [sortColumn, setSortColumn] = useState<FileSortColumn>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [filePreview, setFilePreview] = useState<ProjectFilePreview | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string | null } | null>(null);
  const [noteTargetPath, setNoteTargetPath] = useState<string | null>(null);
  const [isCreateTextFileOpen, setIsCreateTextFileOpen] = useState(false);
  const [availableSources, setAvailableSources] = useState<WorkspaceSourceSummary[]>([]);
  const [selectedSource, setSelectedSource] = useState<WorkspaceSourceSummary | null>(null);

  const sortedEntries = useMemo(
    () => sortProjectFileEntries(entries, sortColumn, sortDirection),
    [entries, sortColumn, sortDirection]
  );
  const attachableSources = useMemo(
    () => availableSources.filter((source) => canAttachWorkspaceSource(source)),
    [availableSources]
  );
  const selectedRelativePaths = sortedEntries
    .filter((entry) => selectedPaths.has(entry.relativePath))
    .map((entry) => entry.relativePath);
  const selectedEntry = selectedPaths.size === 1
    ? sortedEntries.find((entry) => selectedPaths.has(entry.relativePath)) ?? null
    : null;
  const allEntriesSelected = entries.length > 0 && selectedRelativePaths.length === entries.length;
  const noteTargetEntry = noteTargetPath
    ? entries.find((entry) => entry.relativePath === noteTargetPath) ?? null
    : null;

  const loadEntries = useCallback(async (nextPath = ""): Promise<void> => {
    if (!activeProjectId) {
      return;
    }

    setIsLoadingList(true);
    setError(null);
    setSelectedPaths(new Set());
    setLastSelectedIndex(null);
    setFilePreview(null);

    try {
      const apiPath = buildProjectContextPath(nextPath);
      const response = await api.get<ProjectFileListResponse>(
        `/api/projects/${activeProjectId}/files?path=${encodeURIComponent(apiPath)}`
      );
      setCwd(stripContextPrefix(response.cwd));
      setParentPath(response.parentPath ? stripContextPrefix(response.parentPath) : null);
      setEntries(response.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "Directory not found") {
        setCwd(nextPath);
        setParentPath(nextPath ? nextPath.split("/").slice(0, -1).join("/") || "" : null);
        setEntries([]);
        return;
      }
      setError(message);
    } finally {
      setIsLoadingList(false);
    }
  }, [activeProjectId, api]);

  const loadPreview = useCallback(async (relativePath: string): Promise<void> => {
    if (!activeProjectId) {
      return;
    }

    setIsLoadingPreview(true);
    try {
      const preview = await api.get<ProjectFilePreview>(
        `/api/projects/${activeProjectId}/files/content?path=${encodeURIComponent(relativePath)}`
      );
      setFilePreview(preview);
    } catch {
      setFilePreview(null);
    } finally {
      setIsLoadingPreview(false);
    }
  }, [activeProjectId, api]);

  useEffect(() => {
    setContextMenu(null);
    setNoteTargetPath(null);
    setError(null);
    void loadEntries("");
  }, [activeProjectId, loadEntries]);

  useEffect(() => {
    if (!selectedEntry || selectedEntry.kind !== "file") {
      setFilePreview(null);
      return;
    }

    void loadPreview(selectedEntry.relativePath);
  }, [loadPreview, selectedEntry]);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setAvailableSources([]);
      return;
    }

    void api.get<WorkspaceSourceListResponse>(`/api/workspaces/${activeWorkspaceId}/sources`)
      .then((response) => setAvailableSources(response.sources))
      .catch(() => setAvailableSources([]));
  }, [activeWorkspaceId, api]);

  const uploadFiles = useCallback(async (files: FileList | File[] | null): Promise<void> => {
    if (!activeProjectId) {
      return;
    }

    const uploadPlans = planViewerUploads(buildProjectContextPath(cwd), files);
    if (uploadPlans.length === 0) {
      return;
    }

    setIsUploading(true);
    setError(null);
    try {
      for (const upload of uploadPlans) {
        const formData = new FormData();
        formData.append("file", upload.file);
        await api.postForm(`/api/projects/${activeProjectId}/files/upload${buildViewerUploadQuery(upload)}`, formData);
      }

      await loadEntries(cwd);
      setFlash({
        tone: "success",
        text: selectionIncludesFolder(uploadPlans)
          ? "Context folder uploaded."
          : uploadPlans.length === 1
            ? "Context file uploaded."
            : `${uploadPlans.length} context files uploaded.`
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
      setIsDragOver(false);
    }
  }, [activeProjectId, api, cwd, loadEntries, setFlash]);

  const triggerDownload = useCallback(async (paths: string[]): Promise<void> => {
    if (!activeProjectId || paths.length === 0 || isDownloading) {
      return;
    }

    setIsDownloading(true);
    try {
      const url = paths.length === 1
        ? buildDownloadUrl(activeProjectId, paths[0])
        : buildBatchDownloadUrl(activeProjectId, paths, buildProjectContextPath(cwd));

      if (capabilities.supportsNativeDownloads) {
        await platform.saveUrlToFile({
          url,
          token,
          suggestedFilename: paths.length === 1 ? paths[0].split("/").pop() ?? "download" : `project-context-${Date.now()}.zip`
        });
        return;
      }

      await triggerAuthenticatedBrowserDownload({
        url,
        token,
        suggestedFilename: paths.length === 1 ? paths[0].split("/").pop() ?? "download" : `project-context-${Date.now()}.zip`
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDownloading(false);
    }
  }, [activeProjectId, capabilities.supportsNativeDownloads, cwd, isDownloading, platform, token]);

  const deletePaths = useCallback(async (paths: string[]): Promise<void> => {
    if (!activeProjectId || !project || paths.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      paths.length === 1
        ? `Remove ${paths[0]} from project context?`
        : `Remove ${paths.length} selected item(s) from project context?`
    );
    if (!confirmed) {
      return;
    }

    setError(null);
    try {
      const result = await api.post<FileDeleteResponse>(`/api/projects/${activeProjectId}/files/delete`, {
        paths
      });
      setEntries((current) => current.filter((entry) => !result.deletedPaths.some((deletedPath) => (
        entry.relativePath === deletedPath || entry.relativePath.startsWith(`${deletedPath}/`)
      ))));
      setSelectedPaths(new Set());
      setLastSelectedIndex(null);
      setFilePreview(null);
      const notesToRemove = Object.keys(contextNotes).filter((notePath) => (
        paths.some((targetPath) => notePath === targetPath || notePath.startsWith(`${targetPath}/`))
      ));
      if (notesToRemove.length > 0) {
        await patchProject(activeProjectId, {
          jsonPayload: normalizeProjectJsonPayload(removeProjectContextNotes(projectPayload, notesToRemove))
        });
      }
      await loadEntries(cwd);
      setFlash({
        tone: "success",
        text: result.deletedCount === 1 ? "Removed 1 item from context." : `Removed ${result.deletedCount} items from context.`
      });
    } catch (err) {
      // Deletion may have succeeded before note cleanup or storage accounting failed.
      await loadEntries(cwd);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [activeProjectId, api, contextNotes, cwd, loadEntries, patchProject, project, projectPayload, setFlash]);

  const saveNote = useCallback(async (relativePath: string, note: string | null): Promise<void> => {
    if (!activeProjectId) {
      return;
    }

    await patchProject(activeProjectId, {
      jsonPayload: normalizeProjectJsonPayload(setProjectContextNote(projectPayload, relativePath, note))
    });
    setEntries((current) => current.map((entry) => (
      entry.relativePath === relativePath ? { ...entry, note } : entry
    )));
    setFlash({ tone: "success", text: note ? "Context note saved." : "Context note removed." });
  }, [activeProjectId, patchProject, projectPayload, setFlash]);

  const handleSourceAttachmentsSelected = useCallback(async (attachments: TaskAttachment[]): Promise<void> => {
    if (!activeProjectId) {
      return;
    }

    setError(null);

    try {
      const noteAttachments = attachments.filter((attachment) => attachment.kind === "note");
      for (const [index, attachment] of noteAttachments.entries()) {
        await api.post(`/api/projects/${activeProjectId}/files/text?path=${encodeURIComponent(buildProjectContextPath(cwd))}`, {
          name: buildContextSourceNoteFilename(attachment.label, index),
          content: attachment.content
        });
      }

      await loadEntries(cwd);
      setFlash({
        tone: "success",
        text: attachments.length === 1 ? "Imported 1 source item into context." : `Imported ${attachments.length} source items into context.`
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [activeProjectId, api, cwd, loadEntries, setFlash]);

  function selectEntryRange(targetIndex: number, additive: boolean): void {
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
  }

  function handleEntryClick(entry: ProjectFileEntry, index: number, event: ReactMouseEvent): void {
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
  }

  if (!activeProjectId || !project) {
    return (
      <section className="page-content">
        <article className="section-card empty-card">
          <h3>No project selected</h3>
          <p>Select a project to manage shared context.</p>
        </article>
      </section>
    );
  }

  return (
    <section
      className="page-content"
      onClick={() => setContextMenu(null)}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
          return;
        }
        setIsDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragOver(false);
        void uploadFiles(event.dataTransfer.files);
      }}
    >
      <article className="section-card files-layout-card project-context-card" style={isDragOver ? { borderColor: "var(--brand)", boxShadow: "0 0 0 1px color-mix(in srgb, var(--brand) 30%, transparent)" } : undefined}>
        <div className="section-head files-toolbar">
          <div className="files-toolbar-left">
            <button
              className="btn ghost icon-btn"
              type="button"
              disabled={parentPath === null || isLoadingList}
              onClick={() => void loadEntries(parentPath ?? "")}
              title="Up"
            >
              <ArrowUp size={18} />
            </button>
            <button className="btn ghost icon-btn" onClick={() => void loadEntries("")} disabled={isLoadingList} title="Context root">
              <Home size={18} />
            </button>
            <div className="files-toolbar-divider" />
            <div className="project-context-title-block">
              <div className="muted-text project-context-path">
                <span>{cwd || "Context files"}</span>
              </div>
            </div>
          </div>

          <div className="row-actions files-toolbar-actions">
            <div className="project-context-view-toggle">
              <button
                className={`btn ghost icon-btn ${viewMode === "list" ? "active" : ""}`}
                onClick={() => setViewMode("list")}
                style={{ border: "none", height: "1.8rem", width: "2rem", background: viewMode === "list" ? "var(--surface)" : "transparent" }}
                title="List view"
              >
                <ListIcon size={16} />
              </button>
              <button
                className={`btn ghost icon-btn ${viewMode === "grid" ? "active" : ""}`}
                onClick={() => setViewMode("grid")}
                style={{ border: "none", height: "1.8rem", width: "2rem", background: viewMode === "grid" ? "var(--surface)" : "transparent" }}
                title="Grid view"
              >
                <Grid size={16} />
              </button>
            </div>
            {selectedRelativePaths.length > 0 ? <span className="muted-text project-context-selection-copy">{selectedRelativePaths.length} selected</span> : null}
            <button className="btn ghost danger-outline" type="button" disabled={selectedRelativePaths.length === 0} onClick={() => void deletePaths(selectedRelativePaths)}>
              <Trash2 size={14} />
              Remove
            </button>
            <AttachFilesMenu
              variant="button"
              buttonLabel="Attach files"
              popoverPlacement="bottom-end"
              disabled={isUploading}
              isBusy={isUploading}
              onUploadFiles={(files) => {
                void uploadFiles(files);
              }}
              onUploadFolder={(files) => {
                void uploadFiles(files);
              }}
              onCreateTextFile={() => setIsCreateTextFileOpen(true)}
              sourceActions={attachableSources.map((source) => ({
                id: source.id,
                label: source.name,
                onSelect: () => setSelectedSource(source)
              }))}
            />
          </div>
        </div>

        <div className="project-context-helper-bar">
          <div className="muted-text project-context-helper-copy">
            Files here are available to every new task in this project. Drop files or folders to add them.
          </div>
        </div>

        <div className="files-main">
          <ProjectFileBrowser
            isLoadingList={isLoadingList}
            entries={entries}
            sortedEntries={sortedEntries}
            viewMode={viewMode}
            selectedPaths={selectedPaths}
            allEntriesSelected={allEntriesSelected}
            onToggleSelectAll={() => {
              if (allEntriesSelected) {
                setSelectedPaths(new Set());
                return;
              }
              setSelectedPaths(new Set(entries.map((entry) => entry.relativePath)));
            }}
            onSortToggle={(column) => {
              setSortColumn((current) => {
                if (current === column) {
                  setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"));
                  return current;
                }
                setSortDirection("asc");
                return column;
              });
            }}
            renderSortIndicator={(column) => {
              if (sortColumn !== column) {
                return "↕";
              }
              return sortDirection === "asc" ? "↑" : "↓";
            }}
            onEntryClick={(entry, index, event) => handleEntryClick(entry, index, event)}
            onEntryDoubleClick={(entry) => {
              if (entry.kind === "directory") {
                void loadEntries(stripContextPrefix(entry.relativePath));
              }
            }}
            onContextMenu={(event, entry, index) => {
              event.preventDefault();
              event.stopPropagation();
              if (entry && !selectedPaths.has(entry.relativePath)) {
                setSelectedPaths(new Set([entry.relativePath]));
                if (typeof index === "number") {
                  setLastSelectedIndex(index);
                }
              }
              setContextMenu({ x: event.clientX, y: event.clientY, path: entry?.relativePath ?? null });
            }}
            onCheckboxClick={(entry, index, event) => {
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
            }}
          />

          <ProjectContextPreviewPane
            selectedEntry={isLoadingPreview ? selectedEntry : selectedEntry}
            selectedCount={selectedPaths.size}
            filePreview={filePreview}
            isLoadingPreview={isLoadingPreview}
            isDownloading={isDownloading}
            previewDownloadUrl={selectedEntry && activeProjectId ? buildDownloadUrl(activeProjectId, selectedEntry.relativePath) : null}
            previewToken={token}
            onDownload={(relativePath) => {
              void triggerDownload([relativePath]);
            }}
            onEditNote={() => setNoteTargetPath(selectedEntry?.relativePath ?? null)}
            onClose={() => {
              setSelectedPaths(new Set());
              setLastSelectedIndex(null);
              setFilePreview(null);
            }}
          />
        </div>

        {error ? <div className="error-banner" style={{ borderRadius: 0 }}>{error}</div> : null}
      </article>

      <ProjectContextMenu
        contextMenu={contextMenu}
        selectedRelativePaths={selectedRelativePaths}
        selectedPathSet={selectedPaths}
        hasNoteForPath={!!(contextMenu?.path && contextNotes[contextMenu.path])}
        isDownloading={isDownloading}
        onDownload={(paths) => {
          void triggerDownload(paths);
        }}
        onEditNote={() => setNoteTargetPath(contextMenu?.path ?? null)}
        onDelete={(paths) => {
          void deletePaths(paths);
        }}
        onRefresh={() => {
          void loadEntries(cwd);
        }}
        onClose={() => setContextMenu(null)}
      />

      <ProjectContextNoteModal
        isOpen={!!noteTargetEntry}
        targetLabel={noteTargetEntry?.name ?? "context item"}
        initialValue={noteTargetEntry?.note ?? ""}
        onClose={() => setNoteTargetPath(null)}
        onSubmit={async (note) => {
          if (!noteTargetEntry) {
            return;
          }
          await saveNote(noteTargetEntry.relativePath, note);
        }}
      />

      <CreateTextFileModal
        isOpen={isCreateTextFileOpen}
        title="Create context text file"
        description="Create a text file directly inside project context so future tasks can use it immediately."
        submitLabel="Add to context"
        initialName="context-notes.txt"
        onClose={() => setIsCreateTextFileOpen(false)}
        onSubmit={async ({ name, content }) => {
          if (!activeProjectId) {
            return;
          }

          setError(null);
          await api.post(`/api/projects/${activeProjectId}/files/text?path=${encodeURIComponent(buildProjectContextPath(cwd))}`, {
            name,
            content
          });
          await loadEntries(cwd);
          setFlash({ tone: "success", text: "Context text file created." });
        }}
      />

      <SourceFilePickerModal
        api={api}
        workspaceId={activeWorkspaceId}
        projectId={activeProjectId}
        environmentId={activeProjectId}
        source={selectedSource}
        isOpen={selectedSource !== null}
        onClose={() => setSelectedSource(null)}
        onSelect={(attachments) => {
          void handleSourceAttachmentsSelected(attachments);
        }}
        targetLabel="project context"
        destinationPath={buildProjectContextPath(cwd)}
        createDirectories
      />
    </section>
  );
}

export const EnvironmentContextPage = ProjectContextPage;
