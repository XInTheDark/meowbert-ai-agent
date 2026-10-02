import fs from "node:fs";
import archiver from "archiver";
import type { FastifyReply, FastifyRequest } from "fastify";
import { finalizeArchiveAfterReply } from "../../services/files/archive-stream.js";
import type { ArchiveEntry, FileDownload } from "../../services/files/file-download.js";

function attachmentHeader(filename: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function sendZip(
  request: FastifyRequest,
  reply: FastifyReply,
  filename: string,
  addEntries: (archive: archiver.Archiver) => void
) {
  const archive = archiver("zip", { zlib: { level: 6 } });
  reply.header("Content-Type", "application/zip");
  reply.header("Content-Disposition", attachmentHeader(filename));
  archive.on("error", (err) => request.log.error(err));
  addEntries(archive);
  finalizeArchiveAfterReply(archive, (err) => request.log.error(err));
  return reply.send(archive);
}

export function sendFileDownload(request: FastifyRequest, reply: FastifyReply, download: FileDownload) {
  if (download.kind === "directory") {
    return sendZip(request, reply, `${download.filename}.zip`, (archive) => {
      archive.directory(download.absolutePath, false);
    });
  }

  reply.header("Content-Type", download.contentType);
  reply.header("Content-Length", String(download.sizeBytes));
  reply.header("Content-Disposition", attachmentHeader(download.filename));
  return reply.send(fs.createReadStream(download.absolutePath));
}

export function sendBatchDownload(request: FastifyRequest, reply: FastifyReply, entries: ArchiveEntry[]) {
  return sendZip(request, reply, "selected-files.zip", (archive) => {
    for (const entry of entries) {
      if (entry.isDirectory) {
        archive.directory(entry.absolutePath, entry.archivePath);
      } else {
        archive.file(entry.absolutePath, { name: entry.archivePath });
      }
    }
  });
}
