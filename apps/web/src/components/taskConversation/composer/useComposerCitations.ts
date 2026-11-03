import { useCallback, useEffect, useRef, useState, type DragEvent, type RefObject } from "react";
import type { TaskAttachment } from "../../../lib/types";
import type { ComposerEditorHandle } from "./ComposerEditor";
import type { Citation } from "./citationToken";
import type { DropPoint } from "./composerEditorContent";

export type AttachFiles = (files: FileList | File[] | null) => void | Promise<void | Array<TaskAttachment | null>>;

const ATTACHMENT_DRAG_TYPE = "application/x-meowbert-attachment";

function toCitation(attachment: TaskAttachment): Citation | null {
  const path = attachment.relativePath ?? (attachment.kind === "note" ? null : attachment.content);
  return path && attachment.kind !== "note" ? { label: attachment.label, path } : null;
}

export function isCitableAttachment(attachment: TaskAttachment): boolean {
  return toCitation(attachment) !== null;
}

export function startAttachmentDrag(event: DragEvent<HTMLElement>, attachmentId: string): void {
  event.dataTransfer.effectAllowed = "copy";
  event.dataTransfer.setData(ATTACHMENT_DRAG_TYPE, attachmentId);
}

function isInsideEditor(target: EventTarget): boolean {
  return target instanceof Element && target.closest(".chat-editor") !== null;
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

  const attachAndCite = useCallback(async (files: File[], point?: DropPoint): Promise<void> => {
    const keys = editorRef.current?.insertUploadingCitations(files.map((file) => file.name), point) ?? [];
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

  const citeAttachment = useCallback((attachment: TaskAttachment, point?: DropPoint): void => {
    const citation = toCitation(attachment);
    if (!citation) return;
    editorRef.current?.insertCitations([citation], point);
    editorRef.current?.focus();
  }, [editorRef]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>): void => {
    const point = { x: event.clientX, y: event.clientY };
    const inEditor = isInsideEditor(event.target);
    const attachmentId = event.dataTransfer.getData(ATTACHMENT_DRAG_TYPE);
    if (attachmentId) {
      const attachment = attachments.find((candidate) => candidate.id === attachmentId);
      if (attachment && inEditor) citeAttachment(attachment, point);
      return;
    }
    const files = event.dataTransfer.files;
    if (!files || files.length === 0) return;
    if (inEditor) {
      void attachAndCite(Array.from(files), point);
    } else {
      void onAttachFiles(files);
    }
  }, [attachAndCite, attachments, citeAttachment, onAttachFiles]);

  const removeAttachment = useCallback((id: string): void => {
    const attachment = attachments.find((candidate) => candidate.id === id);
    const citation = attachment ? toCitation(attachment) : null;
    if (citation) editorRef.current?.removeCitations(citation.path);
    onRemoveAttachment(id);
  }, [attachments, editorRef, onRemoveAttachment]);

  return { attachAndCite, citeAttachment, handleDrop, removeAttachment, isCitingUpload: activeCitationUploads > 0 };
}
