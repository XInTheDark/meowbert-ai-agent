import { useEffect, useRef, useState } from "react";
import { ApiClient } from "../lib/api";
import { TaskAttachment } from "../lib/types";
import { TASK_FILE_DESTINATION_PENDING_MESSAGE } from "../task/taskFileDestinations";
import { planViewerUploads } from "../environment/fileUploadPlanning";

interface UploadedFilePayload {
  name: string;
  relativePath: string;
  sizeBytes: number | null;
  createdAt: string | null;
  modifiedAt: string | null;
}

interface UseFileUploadOptions {
  destinationPath?: string | null;
  createDirectories?: boolean;
  toAttachmentPath?: (uploaded: UploadedFilePayload) => string;
  missingDestinationMessage?: string;
  initialAttachments?: TaskAttachment[];
}

interface PendingUpload {
  id: string;
  label: string;
}

type UploadFilesInput = FileList | File[] | null;

function buildAttachmentKey(attachment: TaskAttachment): string {
  if (attachment.kind !== "note") {
    return `${attachment.kind}:${attachment.relativePath ?? attachment.content}`;
  }

  return `note:${attachment.content}`;
}

function mergeAttachments(current: TaskAttachment[], next: TaskAttachment[]): TaskAttachment[] {
  if (next.length === 0) {
    return current;
  }

  const merged = [...current];
  const seen = new Set(merged.map(buildAttachmentKey));

  for (const attachment of next) {
    const key = buildAttachmentKey(attachment);
    if (seen.has(key)) {
      const existingIndex = merged.findIndex((entry) => buildAttachmentKey(entry) === key);
      if (existingIndex >= 0 && attachment.forceInclude === true && merged[existingIndex].forceInclude !== true) {
        merged[existingIndex] = {
          ...merged[existingIndex],
          forceInclude: true
        };
      }
      continue;
    }
    seen.add(key);
    merged.push(attachment);
  }

  return merged;
}

function toggleAttachmentForceIncludeFlag(attachment: TaskAttachment): TaskAttachment {
  if (attachment.forceInclude === true) {
    const { forceInclude: _forceInclude, ...rest } = attachment;
    return rest;
  }

  return {
    ...attachment,
    forceInclude: true
  };
}

function buildUploadPath(environmentId: string, options: UseFileUploadOptions): string {
  const query = new URLSearchParams();
  const trimmedPath = options.destinationPath?.trim();

  if (trimmedPath) {
    query.set("path", trimmedPath);
  }

  if (options.createDirectories) {
    query.set("createDirectories", "true");
  }

  const serialized = query.toString();
  if (!serialized) {
    return `/api/projects/${environmentId}/files/upload`;
  }

  return `/api/projects/${environmentId}/files/upload?${serialized}`;
}

export function useFileUpload(api: ApiClient, activeEnvironmentId: string | null, options: UseFileUploadOptions = {}) {
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [error, setError] = useState<string | null>(null);
  const destinationPath = options.destinationPath ?? null;
  const initialAttachmentsRef = useRef<TaskAttachment[]>(options.initialAttachments ?? []);

  useEffect(() => {
    initialAttachmentsRef.current = options.initialAttachments ?? [];
  }, [options.initialAttachments]);

  useEffect(() => {
    setAttachments(initialAttachmentsRef.current);
    setPendingUploads([]);
    setError(null);
  }, [activeEnvironmentId, destinationPath]);

  async function uploadFiles(files: UploadFilesInput): Promise<void> {
    if (!files || !activeEnvironmentId) return;

    const normalizedFiles = Array.isArray(files) ? files : Array.from(files);
    if (normalizedFiles.length === 0) return;

    const normalizedDestinationPath = options.destinationPath?.trim() ?? "";
    if (normalizedDestinationPath.length === 0) {
      setError(options.missingDestinationMessage ?? TASK_FILE_DESTINATION_PENDING_MESSAGE);
      return;
    }

    setError(null);
    const uploadPath = buildUploadPath(activeEnvironmentId, {
      ...options,
      destinationPath: normalizedDestinationPath
    });
    const uploadEntries = planViewerUploads(normalizedDestinationPath, normalizedFiles).map((upload) => ({
      upload,
      pendingId: crypto.randomUUID()
    }));

    setPendingUploads((prev) => [
      ...prev,
      ...uploadEntries.map((entry) => ({
        id: entry.pendingId,
        label: entry.upload.label
      }))
    ]);

    const uploadResults = await Promise.allSettled(
      uploadEntries.map(async (entry) => {
        try {
          const formData = new FormData();
          formData.append("file", entry.upload.file);
          const entryUploadPath = entry.upload.targetPath === normalizedDestinationPath && !entry.upload.createDirectories
            ? uploadPath
            : buildUploadPath(activeEnvironmentId, {
              ...options,
              destinationPath: entry.upload.targetPath,
              createDirectories: options.createDirectories || entry.upload.createDirectories
            });

          const uploaded = await api.postForm<{ file: UploadedFilePayload }>(
            entryUploadPath,
            formData
          );
          const attachmentPath = options.toAttachmentPath?.(uploaded.file) ?? uploaded.file.relativePath;
          const attachment: TaskAttachment = {
            id: crypto.randomUUID(),
            kind: "file",
            label: uploaded.file.name,
            content: attachmentPath,
            relativePath: attachmentPath,
            sizeBytes: uploaded.file.sizeBytes
          };

          setAttachments((prev) => mergeAttachments(prev, [attachment]));
          return {
            ok: true as const
          };
        } finally {
          setPendingUploads((prev) => prev.filter((item) => item.id !== entry.pendingId));
        }
      })
    );

    const failedUploads = uploadResults
      .map((result, index) => ({ result, fileName: uploadEntries[index].upload.label }))
      .filter((entry): entry is { result: PromiseRejectedResult; fileName: string } => entry.result.status === "rejected")
      .map((entry) => {
        const reason = entry.result.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        return `${entry.fileName}: ${message}`;
      });

    if (failedUploads.length > 0) {
      const summary =
        failedUploads.length === 1
          ? `Upload failed — ${failedUploads[0]}`
          : `${failedUploads.length} uploads failed — ${failedUploads.join(" | ")}`;
      setError(summary);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  function toggleAttachmentForceInclude(id: string) {
    setAttachments((prev) => prev.map((attachment) => (
      attachment.id === id
        ? toggleAttachmentForceIncludeFlag(attachment)
        : attachment
    )));
  }

  function clearAttachments() {
    setAttachments([]);
  }

  function appendAttachments(next: TaskAttachment[]) {
    setAttachments((current) => mergeAttachments(current, next));
  }

  return {
    attachments,
    isUploading: pendingUploads.length > 0,
    pendingUploads,
    uploadError: error,
    uploadFiles,
    removeAttachment,
    toggleAttachmentForceInclude,
    clearAttachments,
    appendAttachments,
    setAttachments
  };
}
