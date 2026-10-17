import fs from "node:fs";
import fsPromises from "node:fs/promises";
import type { FastifyReply } from "fastify";
import { injectCanvasFrameRuntime } from "@meowbert/shared/canvas-frame-runtime";
import { getFileContentType } from "../../services/files/file-content-type.js";
import { applyUntrustedContentHeaders } from "./untrusted-content-headers.js";

// Larger HTML is streamed as-is rather than buffered to inject the runtime.
const MAX_INJECTED_HTML_BYTES = 16 * 1024 * 1024;

/** Sends a file that renders inside a canvas frame: HTML pages get the canvas runtime injected. */
export async function sendCanvasFile(reply: FastifyReply, file: {
  absolutePath: string;
  sizeBytes: number;
}, cacheControl: string): Promise<FastifyReply> {
  const contentType = getFileContentType(file.absolutePath);
  reply.header("Content-Type", contentType);
  reply.header("Cache-Control", cacheControl);
  applyUntrustedContentHeaders(reply);

  if (contentType.startsWith("text/html") && file.sizeBytes <= MAX_INJECTED_HTML_BYTES) {
    const html = injectCanvasFrameRuntime(await fsPromises.readFile(file.absolutePath, "utf8"));
    return reply.send(html);
  }

  reply.header("Content-Length", String(file.sizeBytes));
  return reply.send(fs.createReadStream(file.absolutePath));
}
