import fs from "node:fs";
import path from "node:path";
import type { ResponseInputContent, ResponseInputItem } from "openai/resources/responses/responses";
import type { MemoryMainFile } from "../memory/index.js";
import type { WorkspaceImageDetail } from "../workspaces/workspace-model-settings.js";
import { VIEW_IMAGE_MAX_BYTES } from "../agent-tool-dispatch/view-limits.js";
import type { TaskMessageRow } from "./types.js";
import { asText, detectImageMimeTypeFromBuffer } from "./utils.js";

export const DECISION_CONTEXT_PROMPT_CHAR_LIMIT = 40_000;
const DECISION_CONTEXT_RESERVED_PROMPT_CHARS = 4_000;
const DECISION_CONTEXT_TEXT_CHAR_LIMIT = DECISION_CONTEXT_PROMPT_CHAR_LIMIT - DECISION_CONTEXT_RESERVED_PROMPT_CHARS;
const DECISION_CONTEXT_MESSAGE_CHAR_LIMIT = 16_000;
const DECISION_CONTEXT_MEMORY_CHAR_LIMIT = 8_000;
const DECISION_CONTEXT_ATTACHMENT_CHAR_LIMIT = 12_000;
const DECISION_CONTEXT_MESSAGE_LIMIT = 8;
const DECISION_CONTEXT_ATTACHMENT_TEXT_BYTES = 16 * 1024;
const DECISION_CONTEXT_ATTACHMENT_TEXT_CHARS = 4_000;
const DECISION_CONTEXT_MAX_IMAGES = 5;
const DECISION_CONTEXT_MAX_IMAGE_BYTES = Math.min(VIEW_IMAGE_MAX_BYTES, 4 * 1024 * 1024);
const IMAGE_MIME_SNIFF_BYTES = 8192;

interface TaskMessageAttachment {
  kind: "note" | "file" | "directory";
  label: string;
  content: string;
  relativePath?: string;
  sizeBytes?: number | null;
}

export interface TaskDecisionContext {
  text: string;
  imageItems: ResponseInputItem[];
}

export interface TaskDecisionContextInput {
  messages: TaskMessageRow[];
  taskInputDir?: string | null;
  memoryMainFile?: MemoryMainFile | null;
  projectMemoryMainFile?: MemoryMainFile | null;
  imageDetail?: WorkspaceImageDetail;
  mode: "first_user" | "recent";
}

function truncateText(value: string, limit: number): { text: string; truncated: boolean } {
  if (limit <= 0) {
    return { text: "", truncated: value.length > 0 };
  }
  if (value.length <= limit) {
    return { text: value, truncated: false };
  }
  return { text: value.slice(0, Math.max(0, limit - 32)), truncated: true };
}

function formatTruncated(value: string, limit: number): string {
  const truncated = truncateText(value, limit);
  return truncated.truncated ? `${truncated.text}\n[Truncated.]` : truncated.text;
}

function parseTaskMessageAttachments(content: Record<string, unknown>): TaskMessageAttachment[] {
  if (!Array.isArray(content.attachments)) {
    return [];
  }

  const attachments: TaskMessageAttachment[] = [];
  for (const rawAttachment of content.attachments) {
    if (!rawAttachment || typeof rawAttachment !== "object") {
      continue;
    }
    const candidate = rawAttachment as {
      kind?: unknown;
      label?: unknown;
      content?: unknown;
      relativePath?: unknown;
      sizeBytes?: unknown;
    };
    if (
      (candidate.kind !== "note" && candidate.kind !== "file" && candidate.kind !== "directory")
      || typeof candidate.label !== "string"
      || typeof candidate.content !== "string"
    ) {
      continue;
    }
    attachments.push({
      kind: candidate.kind,
      label: candidate.label,
      content: candidate.content,
      ...(typeof candidate.relativePath === "string" ? { relativePath: candidate.relativePath } : {}),
      ...(typeof candidate.sizeBytes === "number" && Number.isFinite(candidate.sizeBytes)
        ? { sizeBytes: candidate.sizeBytes }
        : candidate.sizeBytes === null
          ? { sizeBytes: null }
          : {})
    });
  }

  return attachments;
}

function resolveAttachmentAbsolutePath(attachment: TaskMessageAttachment, taskInputDir: string | null): string | null {
  if (attachment.kind !== "file") {
    return null;
  }

  const attachmentPath = attachment.relativePath ?? attachment.content;
  if (attachmentPath.trim().length === 0) {
    return null;
  }

  if (path.isAbsolute(attachmentPath)) {
    return path.resolve(attachmentPath);
  }

  if (!taskInputDir) {
    return null;
  }

  const normalizedPath = attachmentPath.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (normalizedPath === "inputs" || normalizedPath.startsWith("inputs/")) {
    return path.resolve(taskInputDir, normalizedPath === "inputs" ? "." : normalizedPath.slice("inputs/".length));
  }

  return path.resolve(taskInputDir, attachmentPath);
}

function hasBinaryMarkers(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return true;
  }

  let suspicious = 0;
  for (const byte of buffer) {
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      suspicious += 1;
    }
  }
  return buffer.length > 0 && suspicious / buffer.length > 0.1;
}

function shouldSkipDocumentPreview(filePath: string): boolean {
  return /\.(pdf|doc|docx|ppt|pptx|xls|xlsx|odt|ods|odp)$/i.test(filePath);
}

function readFilePrefix(filePath: string, maxBytes: number): Buffer {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function buildMemorySection(input: TaskDecisionContextInput): string {
  const entries = [
    {
      label: "Workspace MEMORY.md excerpt",
      file: input.memoryMainFile
    },
    {
      label: "Project MEMORY.md excerpt",
      file: input.projectMemoryMainFile
    }
  ];
  const available = entries.filter((entry) => entry.file && entry.file.content.trim().length > 0);
  if (available.length === 0) {
    return "";
  }

  const perEntryLimit = Math.max(1, Math.floor(DECISION_CONTEXT_MEMORY_CHAR_LIMIT / available.length));
  return available.map((entry) => {
    const content = formatTruncated(entry.file?.content.trim() ?? "", perEntryLimit);
    return `### ${entry.label}\n${content}`;
  }).join("\n\n");
}

function selectMessages(input: TaskDecisionContextInput): TaskMessageRow[] {
  if (input.mode === "first_user") {
    const firstUserMessage = input.messages.find((message) => message.role === "user");
    return firstUserMessage ? [firstUserMessage] : [];
  }

  return input.messages.slice(-DECISION_CONTEXT_MESSAGE_LIMIT);
}

function buildMessageSection(input: TaskDecisionContextInput): string {
  const messages = selectMessages(input);
  if (messages.length === 0) {
    return "";
  }

  const perMessageLimit = Math.max(1, Math.floor(DECISION_CONTEXT_MESSAGE_CHAR_LIMIT / messages.length));
  return messages.map((message) => {
    const text = formatTruncated(asText(message.content_json).trim(), perMessageLimit);
    return `### ${message.role} at ${message.created_at}\n${text}`;
  }).join("\n\n");
}

async function buildImageItem(input: {
  filePath: string;
  mimeType: string;
  label: string;
  imageDetail: WorkspaceImageDetail;
}): Promise<ResponseInputItem> {
  const imageContent = {
    type: "input_image",
    detail: input.imageDetail,
    image_url: `data:${input.mimeType};base64,${await fs.promises.readFile(input.filePath, "base64")}`
  } as ResponseInputContent;
  return {
    role: "user",
    content: [
      {
        type: "input_text",
        text: `Attached image for routing/title context: ${input.label}`
      } as ResponseInputContent,
      imageContent
    ]
  };
}

async function buildAttachmentSections(input: TaskDecisionContextInput): Promise<{
  text: string;
  imageItems: ResponseInputItem[];
}> {
  const messages = selectMessages(input);
  const taskInputDir = input.taskInputDir?.trim() ? input.taskInputDir : null;
  const imageDetail = input.imageDetail ?? "high";
  const textParts: string[] = [];
  const imageItems: ResponseInputItem[] = [];
  let textBudget = DECISION_CONTEXT_ATTACHMENT_CHAR_LIMIT;

  for (const message of messages) {
    for (const attachment of parseTaskMessageAttachments(message.content_json)) {
      if (attachment.kind === "note") {
        const note = formatTruncated(attachment.content.trim(), Math.min(textBudget, DECISION_CONTEXT_ATTACHMENT_TEXT_CHARS));
        if (note.length > 0) {
          textParts.push(`### Note attachment: ${attachment.label}\n${note}`);
          textBudget -= note.length;
        }
        continue;
      }

      const filePath = resolveAttachmentAbsolutePath(attachment, taskInputDir);
      const location = attachment.relativePath ?? attachment.content;
      if (attachment.kind === "directory" || !filePath) {
        textParts.push(`### Attachment metadata: ${attachment.label}\nKind: ${attachment.kind}\nPath/content: ${location}`);
        continue;
      }

      try {
        const stats = await fs.promises.stat(filePath);
        if (!stats.isFile()) {
          textParts.push(`### Attachment metadata: ${attachment.label}\nPath: ${location}\nNot a regular file.`);
          continue;
        }

        const sniffBuffer = readFilePrefix(filePath, Math.min(IMAGE_MIME_SNIFF_BYTES, Number(stats.size)));
        const imageMimeType = await detectImageMimeTypeFromBuffer(sniffBuffer);
        if (imageMimeType) {
          if (imageItems.length < DECISION_CONTEXT_MAX_IMAGES && stats.size <= DECISION_CONTEXT_MAX_IMAGE_BYTES) {
            imageItems.push(await buildImageItem({
              filePath,
              mimeType: imageMimeType,
              label: attachment.label,
              imageDetail
            }));
          }
          textParts.push(`### Image attachment: ${attachment.label}\nPath: ${location}\nSize: ${stats.size} bytes`);
          continue;
        }

        if (shouldSkipDocumentPreview(filePath)) {
          textParts.push(`### Attachment metadata: ${attachment.label}\nPath: ${location}\nSkipped preview for document/binary format.`);
          continue;
        }

        if (textBudget <= 0) {
          continue;
        }

        const prefix = readFilePrefix(filePath, Math.min(DECISION_CONTEXT_ATTACHMENT_TEXT_BYTES, Number(stats.size)));
        if (hasBinaryMarkers(prefix)) {
          textParts.push(`### Attachment metadata: ${attachment.label}\nPath: ${location}\nSkipped preview because it looks binary.`);
          continue;
        }

        const excerpt = formatTruncated(prefix.toString("utf8"), Math.min(textBudget, DECISION_CONTEXT_ATTACHMENT_TEXT_CHARS));
        textParts.push(`### File attachment excerpt: ${attachment.label}\nPath: ${location}\n${excerpt}`);
        textBudget -= excerpt.length;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        textParts.push(`### Attachment metadata: ${attachment.label}\nPath: ${location}\nPreview unavailable: ${message}`);
      }
    }
  }

  return {
    text: textParts.join("\n\n"),
    imageItems
  };
}

function compactDecisionContextText(sections: string[]): string {
  const text = sections
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
    .join("\n\n");
  return formatTruncated(text, DECISION_CONTEXT_TEXT_CHAR_LIMIT);
}

export async function buildTaskDecisionContext(input: TaskDecisionContextInput): Promise<TaskDecisionContext> {
  const [attachmentContext, memorySection] = await Promise.all([
    buildAttachmentSections(input),
    Promise.resolve(buildMemorySection(input))
  ]);

  const text = compactDecisionContextText([
    "## User and Conversation Context",
    buildMessageSection(input),
    "## Memory Context",
    memorySection,
    "## Attachment Context",
    attachmentContext.text
  ]);

  return {
    text,
    imageItems: attachmentContext.imageItems
  };
}
