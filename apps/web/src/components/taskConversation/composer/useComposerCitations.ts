import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { TaskAttachment } from "../../../lib/types";
import type { ComposerEditorHandle } from "./ComposerEditor";
import type { Citation } from "./citationToken";

export type AttachFiles = (files: FileList | File[] | null) => void | Promise<void | Array<TaskAttachment | null>>;

export function toCitation(attachment: TaskAttachment): Citation | null {
  const path = attachment.relativePath ?? (attachment.kind === "note" ? null : attachment.content);
  return path && attachment.kind !== "note" ? { label: attachment.label, path } : null;
}

export function isCitableAttachment(attachment: TaskAttachment): boolean {
  return toCitation(attachment) !== null;
}

export function useComposerCitations(input: {
  editorRef: RefObject<ComposerEditorHandle>;
  attachments: TaskAttachment[];
  onAttachFiles: AttachFiles;
  onRemoveAttachment: (id: string) => void;
}) {
  const { editorRef, attachments, onAttachFiles, onRemoveAttachment } = input;
  const [activeCitationUploads, setActiveCitationUploads] = useState(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const attachAndCite = useCallback(async (files: File[]): Promise<void> => {
    const keys = editorRef.current?.insertUploadingCitations(files.map((file) => file.name)) ?? [];
    setActiveCitationUploads((count) => count + 1);
    let uploaded: Array<TaskAttachment | null> = [];
    try {
      const result = await onAttachFiles(files);
      if (Array.isArray(result)) uploaded = result;
    } finally {
      keys.forEach((key, index) => {
        const attachment = uploaded[index] ?? null;
        editorRef.current?.resolveUploadingCitation(key, attachment && toCitation(attachment));
      });
      if (isMountedRef.current) setActiveCitationUploads((count) => count - 1);
    }
  }, [editorRef, onAttachFiles]);

  const citeAttachment = useCallback((attachment: TaskAttachment): void => {
    const citation = toCitation(attachment);
    if (!citation) return;
    editorRef.current?.insertCitations([citation]);
    editorRef.current?.focus();
  }, [editorRef]);

  const removeAttachment = useCallback((id: string): void => {
    const attachment = attachments.find((candidate) => candidate.id === id);
    const citation = attachment ? toCitation(attachment) : null;
    if (citation) editorRef.current?.removeCitations(citation.path);
    onRemoveAttachment(id);
  }, [attachments, editorRef, onRemoveAttachment]);

  return { attachAndCite, citeAttachment, removeAttachment, isCitingUpload: activeCitationUploads > 0 };
}
