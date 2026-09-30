import type { TaskAttachment } from "../lib/types";
import type { WorkspaceSourceAttachedFile, WorkspaceSourceAttachment } from "./sourceTypes";

export function toTaskAttachmentFromSourceAttachment(
  attachment: WorkspaceSourceAttachment,
  toAttachmentPath?: (uploaded: WorkspaceSourceAttachedFile) => string
): TaskAttachment {
  if (attachment.kind === "note") {
    return {
      id: crypto.randomUUID(),
      kind: "note",
      label: attachment.label,
      content: attachment.content,
      sizeBytes: attachment.sizeBytes
    };
  }

  const attachmentPath = toAttachmentPath?.(attachment) ?? attachment.relativePath;
  return {
    id: crypto.randomUUID(),
    kind: attachment.kind,
    label: attachment.name,
    content: attachmentPath,
    relativePath: attachmentPath,
    sizeBytes: attachment.sizeBytes
  };
}
