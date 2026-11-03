import { fileTypeFromFile } from "file-type";
import fs from "node:fs";
import path from "node:path";
import type { ResponseInputContent, ResponseInputItem } from "openai/resources/responses/responses";
import { preparePdfView, type PdfSandboxRuntime } from "../agent-tool-dispatch/pdf.js";
import { VIEW_IMAGE_MAX_BYTES, VIEW_PDF_MAX_INPUT_BYTES, VIEW_PDF_MAX_OUTPUT_BYTES } from "../agent-tool-dispatch/view-limits.js";
import { VIEW_PDF_DEFAULT_PAGE_START } from "../agent-tools/index.js";
import type { WorkspaceImageDetail } from "../workspaces/workspace-model-settings.js";
import { resolveContainedAttachmentPath, type AttachmentRoots } from "./attachment-paths.js";
import type { TaskMessageRow } from "./types.js";

export const FORCE_INCLUDE_TEXT_MAX_BYTES = 200 * 1024;
export const FORCE_INCLUDE_ISSUE_KIND = "force_include_issue";
export const SUPPORTED_VIEW_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp"
]);

export interface TaskMessageAttachment {
  kind: "note" | "file" | "directory";
  label: string;
  content: string;
  relativePath?: string;
  sizeBytes?: number | null;
  forceInclude?: boolean;
}

export interface ForceIncludeOptions {
  roots: AttachmentRoots;
  imageDetail: WorkspaceImageDetail;
  mode: "normal" | "quick";
  pdfRuntime?: PdfSandboxRuntime;
  onIssue?: (issue: string) => void;
}

export function parseTaskMessageAttachments(content: Record<string, unknown>): TaskMessageAttachment[] {
  if (!Array.isArray(content.attachments)) {
    return [];
  }

  return content.attachments.reduce<TaskMessageAttachment[]>((attachments, rawAttachment) => {
    if (!rawAttachment || typeof rawAttachment !== "object") {
      return attachments;
    }

    const candidate = rawAttachment as {
      kind?: unknown;
      label?: unknown;
      content?: unknown;
      relativePath?: unknown;
      sizeBytes?: unknown;
      forceInclude?: unknown;
    };
    if (
      (candidate.kind !== "note" && candidate.kind !== "file" && candidate.kind !== "directory")
      || typeof candidate.label !== "string"
      || typeof candidate.content !== "string"
    ) {
      return attachments;
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
          : {}),
      ...(candidate.forceInclude === true ? { forceInclude: true } : {})
    });
    return attachments;
  }, []);
}

// The user messages no run has answered. Anything older was already delivered to its context window,
// so its files are not read again.
export function selectUnansweredUserMessageIds(messages: TaskMessageRow[]): Set<string> {
  const ids = new Set<string>();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" || message.role === "tool") break;
    if (message.role === "user") ids.add(message.id);
  }
  return ids;
}

export function hasUnansweredForceIncludedAttachment(messages: TaskMessageRow[]): boolean {
  const unanswered = selectUnansweredUserMessageIds(messages);
  return messages.some((message) => (
    unanswered.has(message.id)
    && parseTaskMessageAttachments(message.content_json).some((attachment) => attachment.forceInclude === true)
  ));
}

function isLikelyTextAttachment(attachment: TaskMessageAttachment, filePath: string): boolean {
  const lowerName = `${attachment.label} ${filePath}`.toLowerCase();
  return /\.(txt|md|markdown|csv|tsv|json|jsonl|yaml|yml|xml|html|htm|css|js|jsx|ts|tsx|py|rb|go|rs|java|c|cc|cpp|h|hpp|sh|zsh|bash|sql|toml|ini|env|log)$/i.test(lowerName);
}

function buildSkippedItem(attachment: TaskMessageAttachment, reason: string): ResponseInputItem {
  return {
    role: "user",
    content: `[Attachment force include skipped: ${attachment.label}. ${reason}]`
  };
}

function buildMetadataItem(attachment: TaskMessageAttachment): ResponseInputItem {
  return {
    role: "user",
    content: [
      `[Attachment marked force include: ${attachment.label}]`,
      `Kind: ${attachment.kind}`,
      `Path/content: ${attachment.relativePath ?? attachment.content}`,
      typeof attachment.sizeBytes === "number" ? `Size: ${attachment.sizeBytes} bytes` : null
    ].filter((line): line is string => typeof line === "string").join("\n")
  };
}

async function readTextPrefix(filePath: string, maxBytes: number): Promise<string> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function buildPdfItems(attachment: TaskMessageAttachment, filePath: string, size: number, options: ForceIncludeOptions): Promise<ResponseInputItem[]> {
  if (size > VIEW_PDF_MAX_INPUT_BYTES) {
    options.onIssue?.(`${attachment.label} is too large to force include. PDFs can be up to 50 MB.`);
    return [buildSkippedItem(attachment, "PDF exceeds viewer limit.")];
  }
  const preparedPdf = await preparePdfView({
    fileBuffer: await fs.promises.readFile(filePath),
    fileName: path.basename(filePath),
    pageStart: VIEW_PDF_DEFAULT_PAGE_START,
    pageEnd: Number.MAX_SAFE_INTEGER,
    maxOutputBytes: VIEW_PDF_MAX_OUTPUT_BYTES,
    runtime: options.pdfRuntime
  });
  const fileContent: ResponseInputContent = {
    type: "input_file",
    file_data: `data:application/pdf;base64,${preparedPdf.outputBuffer.toString("base64")}`,
    filename: preparedPdf.outputFileName
  };
  return [{ role: "user", content: [fileContent] }];
}

async function buildImageItems(attachment: TaskMessageAttachment, filePath: string, size: number, mimeType: string, options: ForceIncludeOptions): Promise<ResponseInputItem[]> {
  if (size > VIEW_IMAGE_MAX_BYTES) {
    options.onIssue?.(`${attachment.label} is too large to force include. Images can be up to 20 MB.`);
    return [buildSkippedItem(attachment, "Image exceeds viewer limit.")];
  }
  const imageContent = {
    type: "input_image",
    detail: options.imageDetail,
    image_url: `data:${mimeType};base64,${(await fs.promises.readFile(filePath)).toString("base64")}`
  } as ResponseInputContent;
  return [{
    role: "user",
    content: [
      {
        type: "input_text",
        text: `Force-included image file: ${attachment.label}`
      } as ResponseInputContent,
      imageContent
    ]
  }];
}

async function buildTextItems(attachment: TaskMessageAttachment, filePath: string, size: number, options: ForceIncludeOptions): Promise<ResponseInputItem[]> {
  const location = attachment.relativePath ?? attachment.content;
  const text = await readTextPrefix(filePath, Math.min(size, FORCE_INCLUDE_TEXT_MAX_BYTES));
  if (size <= FORCE_INCLUDE_TEXT_MAX_BYTES) {
    return [{ role: "user", content: `Force-included file (${attachment.label}, ${location}):\n${text}` }];
  }
  options.onIssue?.(`Only the first 200 KB of ${attachment.label} was force included.`);
  return [{
    role: "user",
    content: `Force-included file (${attachment.label}, ${location}):\n${text}\n[Truncated to the first ${FORCE_INCLUDE_TEXT_MAX_BYTES} of ${size} bytes. Open the file to read the rest.]`
  }];
}

function buildUnsupportedItems(attachment: TaskMessageAttachment, options: ForceIncludeOptions): ResponseInputItem[] {
  options.onIssue?.(`${attachment.label} can't be force included because this file type can't be sent to the model. The agent can still open it.`);
  return [buildMetadataItem(attachment)];
}

function skipInQuickMode(attachment: TaskMessageAttachment, options: ForceIncludeOptions): ResponseInputItem[] {
  if (attachment.forceInclude === true) {
    options.onIssue?.(`${attachment.label} wasn't force included because this run is in Quick mode.`);
  }
  return [];
}

export async function buildForceIncludedAttachmentItems(
  attachment: TaskMessageAttachment,
  options: ForceIncludeOptions
): Promise<ResponseInputItem[]> {
  const { mode } = options;
  if (mode === "normal" && attachment.forceInclude !== true) {
    return [];
  }

  if (mode === "quick" && attachment.kind !== "file") {
    return [];
  }

  if (attachment.kind === "note") {
    return [{
      role: "user",
      content: `Force-included note attachment (${attachment.label}):\n${attachment.content}`
    }];
  }

  if (attachment.kind !== "file") {
    return buildUnsupportedItems(attachment, options);
  }

  try {
    const filePath = resolveContainedAttachmentPath(attachment.relativePath ?? attachment.content, options.roots);
    if (!filePath) {
      options.onIssue?.(`${attachment.label} can't be force included because it isn't in this task or project.`);
      return [buildSkippedItem(attachment, "Path is outside the task and project.")];
    }

    const fileStats = await fs.promises.stat(filePath);
    if (!fileStats.isFile()) {
      return mode === "quick" ? [] : buildUnsupportedItems(attachment, options);
    }

    if (filePath.toLowerCase().endsWith(".pdf")) {
      return mode === "quick" ? skipInQuickMode(attachment, options) : await buildPdfItems(attachment, filePath, fileStats.size, options);
    }

    const detected = await fileTypeFromFile(filePath);
    if (detected && SUPPORTED_VIEW_IMAGE_MIME_TYPES.has(detected.mime)) {
      return await buildImageItems(attachment, filePath, fileStats.size, detected.mime, options);
    }

    if (mode === "quick") {
      return skipInQuickMode(attachment, options);
    }

    return isLikelyTextAttachment(attachment, filePath)
      ? await buildTextItems(attachment, filePath, fileStats.size, options)
      : buildUnsupportedItems(attachment, options);
  } catch (error) {
    if (mode === "quick" && attachment.forceInclude !== true) {
      return [];
    }
    const message = error instanceof Error ? error.message : String(error);
    options.onIssue?.(`${attachment.label} couldn't be read, so it wasn't force included.`);
    return [buildSkippedItem(attachment, message)];
  }
}
