import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { openReadablePathWithinRoots } from "@meowbert/shared/server-security";
import type {
  ResponseFunctionToolCall,
  ResponseInputContent,
  ResponseInputItem
} from "openai/resources/responses/responses";
import {
  VIEW_IMAGE_TOOL_NAME,
  VIEW_PDF_DEFAULT_PAGE_END,
  VIEW_PDF_DEFAULT_PAGE_START,
  VIEW_PDF_FILE_TOOL_NAME,
  viewImageArgumentsSchema,
  viewPdfArgumentsSchema
} from "../../agent-tools/index.js";
import { detectImageMimeTypeFromBuffer, parseToolArguments } from "../../agent/utils.js";
import { finishBuiltinToolFailure, finishBuiltinToolSuccess, startBuiltinToolExecution } from "../events.js";
import { preparePdfView } from "../pdf.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled } from "../utils.js";
import {
  formatByteLimit,
  IMAGE_MIME_SNIFF_BYTES,
  VIEW_IMAGE_MAX_BYTES,
  VIEW_PDF_MAX_INPUT_BYTES,
  VIEW_PDF_MAX_OUTPUT_BYTES
} from "../view-limits.js";
import { resolveToolReadableRoots } from "../readable-roots.js";

async function assertReadableFileWithinLimit(fileHandle: FileHandle, maxBytes: number, label: string) {
  const fileStats = await fileHandle.stat();
  if (!fileStats.isFile()) {
    throw new Error("Path is not a file.");
  }
  if (fileStats.size > maxBytes) {
    throw new Error(`${label} exceeds the ${formatByteLimit(maxBytes)} viewer limit.`);
  }

  return fileStats;
}

async function readFileHeader(fileHandle: FileHandle, maxBytes: number): Promise<Buffer> {
  const headerBuffer = Buffer.alloc(maxBytes);
  const { bytesRead } = await fileHandle.read(headerBuffer, 0, headerBuffer.length, 0);
  return headerBuffer.subarray(0, bytesRead);
}

export async function handleViewImage(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(VIEW_IMAGE_TOOL_NAME, outputItem.arguments, viewImageArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "File",
    inputText: parsed.value.file_path
  });

  const filePath = parsed.value.file_path;
  try {
    const opened = await openReadablePathWithinRoots(resolveToolReadableRoots(ctx), filePath);
    try {
      await assertReadableFileWithinLimit(opened.fileHandle, VIEW_IMAGE_MAX_BYTES, "Image file");
      const headerBuffer = await readFileHeader(opened.fileHandle, IMAGE_MIME_SNIFF_BYTES);
      const mimeType = await detectImageMimeTypeFromBuffer(headerBuffer);
      if (!mimeType) {
        throw new Error("File is not a valid supported image (PNG, JPEG, GIF, WEBP, or BMP).");
      }
      const fileBuffer = await opened.fileHandle.readFile();
      const dataUrl = `data:${mimeType};base64,${fileBuffer.toString("base64")}`;

      const output = { ok: true, file_path: opened.realPath };
      const fileName = path.basename(opened.realPath);

      const isModelOpenAi = (ctx.modelType ?? "openai") === "openai";
      const detail = isModelOpenAi && parsed.value.detail === "full" ? "original" : "high";

      const imageContent = {
        type: "input_image",
        detail,
        image_url: dataUrl
      } as ResponseInputContent;
      const imageItem: ResponseInputItem = {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Image file: ${fileName}`
          } as ResponseInputContent,
          imageContent
        ]
      };
      const finished = await finishBuiltinToolSuccess(ctx, execution, output, {
        eventPayload: { file_path: opened.realPath },
        messagePayload: { file_path: opened.realPath }
      });
      return { ...finished, shownItems: [imageItem] };
    } finally {
      await opened.fileHandle.close();
    }
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Failed to read image: ${message}`);
  }
}

export async function handleViewPdf(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(VIEW_PDF_FILE_TOOL_NAME, outputItem.arguments, viewPdfArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
  }

  const filePath = parsed.value.file_path;
  const pageStart = parsed.value.pages?.start ?? VIEW_PDF_DEFAULT_PAGE_START;
  const pageEnd = parsed.value.pages?.end ?? VIEW_PDF_DEFAULT_PAGE_END;
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "File",
    inputText: `${filePath} (pages ${pageStart}-${pageEnd})`
  });

  try {
    const opened = await openReadablePathWithinRoots(resolveToolReadableRoots(ctx), filePath);
    try {
      await assertReadableFileWithinLimit(opened.fileHandle, VIEW_PDF_MAX_INPUT_BYTES, "PDF file");
      const fileName = path.basename(opened.realPath);
      const preparedPdf = await preparePdfView({
        fileBuffer: await opened.fileHandle.readFile(),
        fileName,
        pageStart,
        pageEnd,
        maxOutputBytes: VIEW_PDF_MAX_OUTPUT_BYTES
      });
      const dataUrl = `data:application/pdf;base64,${preparedPdf.outputBuffer.toString("base64")}`;

      const output = {
        ok: true,
        file_path: opened.realPath,
        pages: {
          start: preparedPdf.effectivePageStart,
          end: preparedPdf.effectivePageEnd
        },
        total_pages: preparedPdf.totalPages,
        ...(preparedPdf.message ? { message: preparedPdf.message } : {})
      };

      const fileContent: ResponseInputContent = {
        type: "input_file",
        file_data: dataUrl,
        filename: preparedPdf.outputFileName
      };
      const fileItem: ResponseInputItem = { role: "user", content: [fileContent] };
      const finished = await finishBuiltinToolSuccess(ctx, execution, output, {
        eventPayload: {
          file_path: opened.realPath,
          pageStart: preparedPdf.effectivePageStart,
          pageEnd: preparedPdf.effectivePageEnd,
          totalPages: preparedPdf.totalPages
        },
        messagePayload: {
          file_path: opened.realPath,
          pages: {
            start: preparedPdf.effectivePageStart,
            end: preparedPdf.effectivePageEnd
          },
          total_pages: preparedPdf.totalPages,
          ...(preparedPdf.message ? { message: preparedPdf.message } : {})
        }
      });
      return { ...finished, shownItems: [fileItem] };
    } finally {
      await opened.fileHandle.close();
    }
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Failed to read PDF: ${message}`);
  }
}
