import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useAppRuntime } from "../../../contexts/AppRuntimeContext";
import { useWorkspaceApp } from "../../../contexts/WorkspaceContext";
import { buildViewerUploadQuery, planViewerUploads, selectionIncludesFolder } from "../../../project/fileUploadPlanning";

interface UseProjectFileUploadsOptions {
  projectId: string | null;
  cwd: string;
  storageStatus: "idle" | "loading" | "ready" | "error";
  loadFiles: (path?: string) => Promise<void>;
  loadStorageSummary: () => Promise<void>;
  setError: Dispatch<SetStateAction<string | null>>;
  onPickerOpening: () => void;
}

export function useProjectFileUploads(options: UseProjectFileUploadsOptions) {
  const { api, setFlash } = useWorkspaceApp();
  const { platform, capabilities } = useAppRuntime();
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const setFolderInputElement = useCallback((node: HTMLInputElement | null) => {
    folderInputRef.current = node;
    if (node) {
      node.setAttribute("webkitdirectory", "");
      node.setAttribute("directory", "");
    }
  }, []);

  const uploadFiles = useCallback(async (files: FileList | File[] | null): Promise<void> => {
    if (!options.projectId) {
      return;
    }
    const uploadPlans = planViewerUploads(options.cwd, files);
    if (uploadPlans.length === 0) {
      return;
    }
    setIsUploading(true);
    options.setError(null);
    try {
      for (const upload of uploadPlans) {
        const formData = new FormData();
        formData.append("file", upload.file);
        try {
          await api.postForm(`/api/projects/${options.projectId}/files/upload${buildViewerUploadQuery(upload)}`, formData);
        } catch (error) {
          throw new Error(`Failed to upload ${upload.label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (options.storageStatus === "ready") {
        await Promise.all([options.loadFiles(options.cwd), options.loadStorageSummary()]);
      } else {
        await options.loadFiles(options.cwd);
      }
      setFlash({ tone: "success", text: selectionIncludesFolder(uploadPlans) ? "Folder uploaded." : uploadPlans.length === 1 ? "File uploaded." : `${uploadPlans.length} files uploaded.` });
    } catch (error) {
      options.setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      if (folderInputRef.current) {
        folderInputRef.current.value = "";
      }
    }
  }, [api, options.cwd, options.loadFiles, options.loadStorageSummary, options.projectId, options.setError, options.storageStatus, setFlash]);

  const openFilePicker = useCallback(async (): Promise<void> => {
    if (isUploading) {
      return;
    }
    options.onPickerOpening();
    if (capabilities.supportsNativeFileDialogs) {
      const files = await platform.pickFiles();
      if (files.length > 0) {
        await uploadFiles(files);
      }
      return;
    }
    fileInputRef.current?.click();
  }, [capabilities.supportsNativeFileDialogs, isUploading, options.onPickerOpening, platform, uploadFiles]);

  useEffect(() => {
    const handleUploadRequest = (): void => {
      void openFilePicker();
    };
    window.addEventListener("meowbert:request-upload", handleUploadRequest);
    return () => window.removeEventListener("meowbert:request-upload", handleUploadRequest);
  }, [openFilePicker]);

  return {
    isUploading,
    fileInputRef,
    setFolderInputElement,
    uploadFiles,
    openFilePicker,
    openFolderPicker: () => {
      if (!isUploading) {
        options.onPickerOpening();
        folderInputRef.current?.click();
      }
    }
  };
}
