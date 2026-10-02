import { useCallback, useState } from "react";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";
import type { FileDeleteResponse, TaskAttachment } from "../../../lib/types";
import {
  buildProjectContextPath,
  getProjectContextNotes,
  normalizeProjectJsonPayload,
  removeProjectContextNotes,
  setProjectContextNote
} from "../../../lib/utils";
import { buildViewerUploadQuery, planViewerUploads, selectionIncludesFolder } from "../../../project/fileUploadPlanning";
import { buildContextSourceNoteFilename } from "./contextPaths";
import type { ProjectContextListing } from "./useProjectContextListing";

interface UseProjectContextActionsOptions {
  projectId: string | null;
  projectPayload: Record<string, unknown>;
  listing: ProjectContextListing;
  resetSelection: () => void;
  setError: (error: string | null) => void;
}

function uploadedLabel(count: number, includesFolder: boolean): string {
  if (includesFolder) return "Context folder uploaded.";
  return count === 1 ? "Context file uploaded." : `${count} context files uploaded.`;
}

// Everything that changes the project's context: uploads, removals (with their notes),
// notes, new text files and notes imported from connected sources.
export function useProjectContextActions(options: UseProjectContextActionsOptions) {
  const workspaceApp = useWorkspaceApp();
  const { api, setFlash } = workspaceApp;
  const patchProject = workspaceApp.patchProject ?? workspaceApp.patchEnvironment;
  const { projectId, projectPayload, listing, resetSelection, setError } = options;
  const { cwd, loadEntries } = listing;
  const contextPath = buildProjectContextPath(cwd);
  const [isUploading, setIsUploading] = useState(false);

  const uploadFiles = useCallback(async (files: FileList | File[] | null): Promise<void> => {
    if (!projectId) return;
    const uploadPlans = planViewerUploads(contextPath, files);
    if (uploadPlans.length === 0) return;

    setIsUploading(true);
    setError(null);
    try {
      for (const upload of uploadPlans) {
        const formData = new FormData();
        formData.append("file", upload.file);
        await api.postForm(`/api/projects/${projectId}/files/upload${buildViewerUploadQuery(upload)}`, formData);
      }
      await loadEntries(cwd);
      setFlash({ tone: "success", text: uploadedLabel(uploadPlans.length, selectionIncludesFolder(uploadPlans)) });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsUploading(false);
    }
  }, [api, contextPath, cwd, loadEntries, projectId, setError, setFlash]);

  const deletePaths = useCallback(async (paths: string[]): Promise<void> => {
    if (!projectId || paths.length === 0) return;
    const prompt = paths.length === 1
      ? `Remove ${paths[0]} from project context?`
      : `Remove ${paths.length} selected item(s) from project context?`;
    if (!window.confirm(prompt)) return;

    setError(null);
    try {
      const result = await api.post<FileDeleteResponse>(`/api/projects/${projectId}/files/delete`, { paths });
      listing.removeEntries(result.deletedPaths);
      resetSelection();
      const notesToRemove = Object.keys(getProjectContextNotes(projectPayload)).filter((notePath) => (
        paths.some((targetPath) => notePath === targetPath || notePath.startsWith(`${targetPath}/`))
      ));
      if (notesToRemove.length > 0) {
        await patchProject(projectId, {
          jsonPayload: normalizeProjectJsonPayload(removeProjectContextNotes(projectPayload, notesToRemove))
        });
      }
      await loadEntries(cwd);
      setFlash({
        tone: "success",
        text: result.deletedCount === 1 ? "Removed 1 item from context." : `Removed ${result.deletedCount} items from context.`
      });
    } catch (error) {
      // Deletion may have succeeded before note cleanup or storage accounting failed.
      await loadEntries(cwd);
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [api, cwd, listing, loadEntries, patchProject, projectId, projectPayload, resetSelection, setError, setFlash]);

  const saveNote = useCallback(async (relativePath: string, note: string | null): Promise<void> => {
    if (!projectId) return;
    await patchProject(projectId, {
      jsonPayload: normalizeProjectJsonPayload(setProjectContextNote(projectPayload, relativePath, note))
    });
    listing.setEntryNote(relativePath, note);
    setFlash({ tone: "success", text: note ? "Context note saved." : "Context note removed." });
  }, [listing, patchProject, projectId, projectPayload, setFlash]);

  const createTextFile = useCallback(async (name: string, content: string): Promise<void> => {
    if (!projectId) return;
    setError(null);
    await api.post(`/api/projects/${projectId}/files/text?path=${encodeURIComponent(contextPath)}`, { name, content });
    await loadEntries(cwd);
    setFlash({ tone: "success", text: "Context text file created." });
  }, [api, contextPath, cwd, loadEntries, projectId, setError, setFlash]);

  const importSourceAttachments = useCallback(async (attachments: TaskAttachment[]): Promise<void> => {
    if (!projectId) return;
    setError(null);
    try {
      const noteAttachments = attachments.filter((attachment) => attachment.kind === "note");
      for (const [index, attachment] of noteAttachments.entries()) {
        await api.post(`/api/projects/${projectId}/files/text?path=${encodeURIComponent(contextPath)}`, {
          name: buildContextSourceNoteFilename(attachment.label, index),
          content: attachment.content
        });
      }
      await loadEntries(cwd);
      setFlash({
        tone: "success",
        text: attachments.length === 1 ? "Imported 1 source item into context." : `Imported ${attachments.length} source items into context.`
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }, [api, contextPath, cwd, loadEntries, projectId, setError, setFlash]);

  return { isUploading, uploadFiles, deletePaths, saveNote, createTextFile, importSourceAttachments };
}
