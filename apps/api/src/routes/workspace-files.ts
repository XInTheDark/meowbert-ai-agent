import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { ensureDirectoryWithinRoot, resolveRealPathWithinRoot } from "@meowbert/shared/server-security";
import { query } from "../lib/db.js";
import { finalizeArchiveAfterReply } from "../services/files/archive-stream.js";
import { buildBatchDownloadArchivePath } from "../services/files/batch-download-archive.js";
import { listDirectorySizeEntries } from "../services/files/file-browser-metadata.js";
import { deleteResolvedTargets, resolveDeletionTargetsWithinRoot } from "../services/files/file-browser.js";
import { getFileContentType } from "../services/files/file-content-type.js";
import { saveUploadedFile } from "../services/files/save-uploaded-file.js";
import { getWorkspaceStorageUsage } from "../services/workspaces/workspace-storage-usage.js";
import { assertWorkspaceMember } from "../services/workspaces/workspace-access.js";
import { ensureWorkspaceStorageRoot } from "../services/workspaces/workspace-storage.js";

const workspaceParamsSchema = z.object({
  wsId: z.string().uuid()
});

const workspaceFileQuery = z.object({
  path: z.string().max(1200).optional()
});

const requiredWorkspaceFileQuery = z.object({
  path: z.string().min(1).max(1200)
});

const workspaceBatchFileDownloadQuery = z.object({
  path: z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .transform((paths) => paths.map((value) => value.trim()).filter((value) => value.length > 0))
    .refine((paths) => paths.length > 0, { message: "At least one file path is required" })
    .refine((paths) => paths.length <= 200, { message: "A maximum of 200 paths can be downloaded at once" }),
  cwd: z.string().max(1200).optional().default("")
});

const booleanQuerySchema = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }

  return value;
}, z.boolean());

const workspaceFileUploadQuery = z.object({
  path: z.string().max(1200).optional(),
  createDirectories: booleanQuerySchema.optional().default(false)
});

const workspaceDeleteFilesBody = z.object({
  paths: z.array(z.string().min(1).max(1200)).min(1).max(200)
});

const FILE_PREVIEW_LIMIT_BYTES = 300_000;
const FILE_UPLOAD_LIMIT_BYTES = 100 * 1024 * 1024;

function toWebPath(input: string): string {
  return input.split(path.sep).join("/");
}

function toIsoTimestamp(value: Date | undefined | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = value.getTime();
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return value.toISOString();
}

export const workspaceFileRoutes: FastifyPluginAsync = async (fastify) => {
  async function getWorkspaceForUser(workspaceId: string, userId: string): Promise<{ id: string; root_path: string }> {
    await assertWorkspaceMember(workspaceId, userId);

    const workspaceRes = await query<{ id: string; root_path: string }>(
      `SELECT id, root_path
         FROM workspaces
        WHERE id = $1`,
      [workspaceId]
    );

    if ((workspaceRes.rowCount ?? 0) === 0) {
      throw new Error("Workspace not found");
    }

    return {
      ...workspaceRes.rows[0],
      root_path: await ensureWorkspaceStorageRoot(workspaceRes.rows[0])
    };
  }

  fastify.get("/api/workspaces/:wsId/files", { preHandler: fastify.authenticate }, async (request) => {
    const params = workspaceParamsSchema.parse(request.params);
    const queryInput = workspaceFileQuery.parse(request.query);
    const workspace = await getWorkspaceForUser(params.wsId, request.user.id);
    const target = await resolveRealPathWithinRoot(workspace.root_path, queryInput.path);
    const folderStats = await fsPromises.lstat(target.absolutePath).catch(() => null);

    if (!folderStats || !folderStats.isDirectory()) {
      throw new Error("Directory not found");
    }

    const entries = await fsPromises.readdir(target.absolutePath, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (entry) => {
        const absoluteEntryPath = path.join(target.absolutePath, entry.name);
        const entryStats = await fsPromises.lstat(absoluteEntryPath).catch(() => null);
        const relativePath = toWebPath(path.relative(target.rootRealPath, absoluteEntryPath));
        const kind = entryStats?.isDirectory()
          ? "directory"
          : entryStats?.isFile()
            ? "file"
            : entryStats?.isSymbolicLink()
              ? "symlink"
              : "other";

        return {
          name: entry.name,
          relativePath,
          kind,
          sizeBytes: entryStats?.isFile() ? entryStats.size : null,
          createdAt: toIsoTimestamp(entryStats?.birthtime),
          modifiedAt: toIsoTimestamp(entryStats?.mtime)
        };
      })
    );

    items.sort((left, right) => {
      const leftRank = left.kind === "directory" ? 0 : left.kind === "file" ? 1 : 2;
      const rightRank = right.kind === "directory" ? 0 : right.kind === "file" ? 1 : 2;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });

    const parentPath =
      target.relativePath === ""
        ? null
        : (() => {
            const parent = path.dirname(target.relativePath);
            return parent === "." ? "" : toWebPath(parent);
          })();

    return {
      cwd: target.relativePath,
      parentPath: target.relativePath === "" ? null : parentPath,
      items
    };
  });

  fastify.get("/api/workspaces/:wsId/files/storage", { preHandler: fastify.authenticate }, async (request) => {
    const params = workspaceParamsSchema.parse(request.params);
    const workspace = await getWorkspaceForUser(params.wsId, request.user.id);
    const storage = await getWorkspaceStorageUsage({
      workspaceId: workspace.id,
      workspaceRootPath: workspace.root_path,
      actorUserId: request.user.id
    });

    return { storage };
  });

  fastify.get("/api/workspaces/:wsId/files/directory-sizes", { preHandler: fastify.authenticate }, async (request) => {
    const params = workspaceParamsSchema.parse(request.params);
    const queryInput = workspaceFileQuery.parse(request.query);
    const workspace = await getWorkspaceForUser(params.wsId, request.user.id);

    return listDirectorySizeEntries({
      rootPath: workspace.root_path,
      requestedPath: queryInput.path
    });
  });

  fastify.get("/api/workspaces/:wsId/files/content", { preHandler: fastify.authenticate }, async (request) => {
    const params = workspaceParamsSchema.parse(request.params);
    const queryInput = requiredWorkspaceFileQuery.parse(request.query);
    const workspace = await getWorkspaceForUser(params.wsId, request.user.id);
    const target = await resolveRealPathWithinRoot(workspace.root_path, queryInput.path);
    const fileStats = await fsPromises.lstat(target.absolutePath).catch(() => null);

    if (!fileStats || !fileStats.isFile()) {
      throw new Error("File not found");
    }

    const previewBytes = Math.min(fileStats.size, FILE_PREVIEW_LIMIT_BYTES);
    const fileHandle = await fsPromises.open(target.absolutePath, "r");
    const previewBuffer = Buffer.alloc(previewBytes);

    try {
      if (previewBytes > 0) {
        await fileHandle.read(previewBuffer, 0, previewBytes, 0);
      }
    } finally {
      await fileHandle.close();
    }

    const containsNullByte = previewBuffer.includes(0);
    return {
      relativePath: target.relativePath,
      sizeBytes: fileStats.size,
      truncated: fileStats.size > previewBytes,
      encoding: containsNullByte ? "binary" : "utf-8",
      text: containsNullByte ? null : previewBuffer.toString("utf8")
    };
  });

  fastify.get("/api/workspaces/:wsId/files/download", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = workspaceParamsSchema.parse(request.params);
    const queryInput = requiredWorkspaceFileQuery.parse(request.query);
    const workspace = await getWorkspaceForUser(params.wsId, request.user.id);
    const target = await resolveRealPathWithinRoot(workspace.root_path, queryInput.path);
    const fileStats = await fsPromises.lstat(target.absolutePath).catch(() => null);

    if (!fileStats) {
      throw new Error("File or directory not found");
    }

    if (fileStats.isDirectory()) {
      const archive = archiver("zip", {
        zlib: { level: 6 }
      });

      const filename = path.basename(target.absolutePath);
      reply.header("Content-Type", "application/zip");
      reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}.zip`);

      archive.on("error", (err) => {
        request.log.error(err);
      });

      archive.directory(target.absolutePath, false);
      finalizeArchiveAfterReply(archive, (err) => request.log.error(err));
      return reply.send(archive);
    }

    if (!fileStats.isFile()) {
      throw new Error("Not a file or directory");
    }

    const filename = path.basename(target.absolutePath);
    reply.header("Content-Type", getFileContentType(target.absolutePath));
    reply.header("Content-Length", String(fileStats.size));
    reply.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    return reply.send(fs.createReadStream(target.absolutePath));
  });

  fastify.get("/api/workspaces/:wsId/files/download/batch", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = workspaceParamsSchema.parse(request.params);
    const queryInput = workspaceBatchFileDownloadQuery.parse(request.query);
    const workspace = await getWorkspaceForUser(params.wsId, request.user.id);
    const currentDirectory = queryInput.cwd.length > 0
      ? await resolveRealPathWithinRoot(workspace.root_path, queryInput.cwd)
      : null;

    if (currentDirectory) {
      const currentDirectoryStats = await fsPromises.lstat(currentDirectory.absolutePath).catch(() => null);
      if (!currentDirectoryStats?.isDirectory()) {
        throw new Error("Current directory not found");
      }
    }

    const uniquePaths = Array.from(new Set(queryInput.path));
    const resolvedTargets = await Promise.all(
      uniquePaths.map(async (requestedPath) => {
        const target = await resolveRealPathWithinRoot(workspace.root_path, requestedPath);
        if (!target.relativePath) {
          throw new Error("Cannot batch download the workspace root");
        }

        const stats = await fsPromises.lstat(target.absolutePath).catch(() => null);
        if (!stats) {
          throw new Error(`Path not found: ${requestedPath}`);
        }
        if (!stats.isFile() && !stats.isDirectory()) {
          throw new Error(`Unsupported path type: ${requestedPath}`);
        }

        return {
          ...target,
          isDirectory: stats.isDirectory()
        };
      })
    );

    const sortedTargets = [...resolvedTargets].sort((left, right) => left.relativePath.length - right.relativePath.length);
    const deduplicatedTargets: typeof sortedTargets = [];
    for (const target of sortedTargets) {
      const alreadyCoveredByDirectory = deduplicatedTargets.some(
        (existing) =>
          existing.isDirectory
          && (target.relativePath === existing.relativePath || target.relativePath.startsWith(`${existing.relativePath}/`))
      );

      if (!alreadyCoveredByDirectory) {
        deduplicatedTargets.push(target);
      }
    }

    const archive = archiver("zip", {
      zlib: { level: 6 }
    });

    reply.header("Content-Type", "application/zip");
    reply.header("Content-Disposition", "attachment; filename*=UTF-8''selected-files.zip");

    archive.on("error", (err) => {
      request.log.error(err);
    });

    for (const target of deduplicatedTargets) {
      const archivePath = buildBatchDownloadArchivePath({
        currentDirectory: currentDirectory?.relativePath ?? "",
        targetRelativePath: target.relativePath
      });

      if (target.isDirectory) {
        archive.directory(target.absolutePath, archivePath);
      } else {
        archive.file(target.absolutePath, { name: archivePath });
      }
    }

    finalizeArchiveAfterReply(archive, (err) => request.log.error(err));
    return reply.send(archive);
  });

  fastify.post("/api/workspaces/:wsId/files/delete", { preHandler: fastify.authenticate }, async (request) => {
    const params = workspaceParamsSchema.parse(request.params);
    const body = workspaceDeleteFilesBody.parse(request.body ?? {});
    const workspace = await getWorkspaceForUser(params.wsId, request.user.id);
    const targets = await resolveDeletionTargetsWithinRoot({
      rootPath: workspace.root_path,
      requestedPaths: body.paths,
      rootLabel: "workspace"
    });
    const deleted = await deleteResolvedTargets(targets);
    const storage = await getWorkspaceStorageUsage({
      workspaceId: workspace.id,
      workspaceRootPath: workspace.root_path,
      actorUserId: request.user.id
    });

    return {
      ...deleted,
      storage
    };
  });

  fastify.post("/api/workspaces/:wsId/files/upload", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = workspaceParamsSchema.parse(request.params);
    const queryInput = workspaceFileUploadQuery.parse(request.query);
    const workspace = await getWorkspaceForUser(params.wsId, request.user.id);
    const targetDirectory = await ensureDirectoryWithinRoot({
      rootPath: workspace.root_path,
      requestedPath: queryInput.path,
      createDirectories: queryInput.createDirectories
    });

    const upload = await request.file({
      limits: {
        files: 1,
        fileSize: FILE_UPLOAD_LIMIT_BYTES
      }
    });

    if (!upload) {
      throw new Error("No file was uploaded");
    }

    const saved = await saveUploadedFile({
      targetDirectory,
      filename: upload.filename,
      file: upload.file,
      limitBytes: FILE_UPLOAD_LIMIT_BYTES
    });

    return reply.status(201).send({ file: saved.file });
  });
};
