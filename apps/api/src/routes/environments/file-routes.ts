import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ensureSandboxWritablePath } from "@meowbert/shared";
import { getProjectContextNote } from "@meowbert/shared/project-context";
import { ensureDirectoryWithinRoot, resolveRealPathWithinRoot } from "@meowbert/shared/server-security";
import { buildEnvironmentCleanupPlan } from "../../services/environments/environment-file-cleanup.js";
import { finalizeArchiveAfterReply } from "../../services/files/archive-stream.js";
import { buildBatchDownloadArchivePath } from "../../services/files/batch-download-archive.js";
import { createTextFileWithinRoot } from "../../services/files/create-text-file.js";
import { listDirectorySizeEntries } from "../../services/files/file-browser-metadata.js";
import { deleteResolvedTargets, resolveDeletionTargetsWithinRoot } from "../../services/files/file-browser.js";
import { getFileContentType } from "../../services/files/file-content-type.js";
import { resolveProjectFileDirectory } from "../../services/files/project-file-directory.js";
import { saveUploadedFile } from "../../services/files/save-uploaded-file.js";
import { listSourceFileLinksForEnvironmentPaths } from "../../services/source-file-links/store.js";
import {
  getSourceFileLinkStatusByEnvironmentPath,
  pullSourceFileLinkByEnvironmentPath,
  pushSourceFileLinkByEnvironmentPath,
  unlinkSourceFileLinkByEnvironmentPath,
  unlinkSourceFileLinksAtMissingEnvironmentPaths,
  unlinkSourceFileLinksUnderEnvironmentPaths
} from "../../services/source-file-links/service.js";
import type { SourceFileLinkSummary } from "../../services/source-file-links/types.js";
import { getWorkspaceStorageUsage } from "../../services/workspaces/workspace-storage-usage.js";
import {
  environmentBatchFileDownloadQuery,
  environmentCleanupQuery,
  environmentDeleteFilesBody,
  environmentCreateTextFileBody,
  environmentFileQuery,
  environmentFileUploadQuery,
  environmentParams,
  FILE_PREVIEW_LIMIT_BYTES,
  FILE_UPLOAD_LIMIT_BYTES,
  getEnvironmentForUser,
  requiredEnvironmentFileQuery,
  toIsoTimestamp,
  toWebPath
} from "./shared.js";

const liveSyncPathQuery = z.object({
  path: z.string().trim().min(1).max(1200)
});

const liveSyncMutationBody = z.object({
  path: z.string().trim().min(1).max(1200),
  force: z.boolean().optional()
}).strict();

const liveSyncUnlinkBody = z.object({
  path: z.string().trim().min(1).max(1200)
}).strict();

function summarizeLiveSyncLink(link: SourceFileLinkSummary) {
  return {
    id: link.id,
    provider: link.provider,
    sourceId: link.sourceId,
    linkKind: link.linkKind,
    remoteName: link.remoteName,
    remoteWebUrl: link.remoteWebUrl,
    lastPulledAt: link.lastPulledAt,
    lastPushedAt: link.lastPushedAt,
    lastSyncError: link.lastSyncError
  };
}

export async function registerEnvironmentFileRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/projects/:envId/files", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const queryInput = environmentFileQuery.parse(request.query);
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    const target = await resolveProjectFileDirectory(environment.root_path, queryInput.path);
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
          modifiedAt: toIsoTimestamp(entryStats?.mtime),
          note: getProjectContextNote(environment.json_payload, relativePath)
        };
      })
    );

    const liveSyncLinks = await listSourceFileLinksForEnvironmentPaths(
      environment.id,
      items.map((item) => item.relativePath)
    );
    const liveSyncByPath = new Map(
      liveSyncLinks.map((link) => [link.localRelativePath, summarizeLiveSyncLink(link)])
    );
    const annotatedItems = items.map((item) => ({
      ...item,
      liveSync: liveSyncByPath.get(item.relativePath) ?? null
    }));

    annotatedItems.sort((left, right) => {
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
      items: annotatedItems
    };
  });

  fastify.get("/api/projects/:envId/files/live-sync", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const queryInput = liveSyncPathQuery.parse(request.query ?? {});
    const environment = await getEnvironmentForUser(params.envId, request.user.id);

    return getSourceFileLinkStatusByEnvironmentPath({
      environmentId: environment.id,
      environmentRootPath: environment.root_path,
      localRelativePath: queryInput.path
    });
  });

  fastify.post("/api/projects/:envId/files/live-sync/pull", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const body = liveSyncMutationBody.parse(request.body ?? {});
    const environment = await getEnvironmentForUser(params.envId, request.user.id);

    return pullSourceFileLinkByEnvironmentPath({
      environmentId: environment.id,
      environmentRootPath: environment.root_path,
      workspaceRootPath: environment.workspace_root_path,
      actorUserId: request.user.id,
      localRelativePath: body.path,
      force: body.force
    });
  });

  fastify.post("/api/projects/:envId/files/live-sync/push", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const body = liveSyncMutationBody.parse(request.body ?? {});
    const environment = await getEnvironmentForUser(params.envId, request.user.id);

    return pushSourceFileLinkByEnvironmentPath({
      environmentId: environment.id,
      environmentRootPath: environment.root_path,
      actorUserId: request.user.id,
      localRelativePath: body.path,
      force: body.force
    });
  });

  fastify.post("/api/projects/:envId/files/live-sync/unlink", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = environmentParams.parse(request.params);
    const body = liveSyncUnlinkBody.parse(request.body ?? {});
    const environment = await getEnvironmentForUser(params.envId, request.user.id);

    await unlinkSourceFileLinkByEnvironmentPath({
      environmentId: environment.id,
      localRelativePath: body.path
    });

    return reply.send({ ok: true });
  });

  fastify.get("/api/projects/:envId/files/storage", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    const storage = await getWorkspaceStorageUsage({
      workspaceId: environment.workspace_id,
      workspaceRootPath: environment.workspace_root_path,
      actorUserId: request.user.id
    });

    return { storage };
  });

  fastify.get("/api/projects/:envId/files/directory-sizes", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const queryInput = environmentFileQuery.parse(request.query);
    const environment = await getEnvironmentForUser(params.envId, request.user.id);

    return listDirectorySizeEntries({
      rootPath: environment.root_path,
      requestedPath: queryInput.path
    });
  });

  fastify.get("/api/projects/:envId/files/content", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const queryInput = requiredEnvironmentFileQuery.parse(request.query);
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    const target = await resolveRealPathWithinRoot(environment.root_path, queryInput.path);
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

  fastify.get("/api/projects/:envId/files/download", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = environmentParams.parse(request.params);
    const queryInput = requiredEnvironmentFileQuery.parse(request.query);
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    const target = await resolveRealPathWithinRoot(environment.root_path, queryInput.path);
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

  fastify.get("/api/projects/:envId/files/download/batch", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = environmentParams.parse(request.params);
    const queryInput = environmentBatchFileDownloadQuery.parse(request.query);
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    const currentDirectory = queryInput.cwd.length > 0
      ? await resolveRealPathWithinRoot(environment.root_path, queryInput.cwd)
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
        const target = await resolveRealPathWithinRoot(environment.root_path, requestedPath);
        if (!target.relativePath) {
          throw new Error("Cannot batch download the environment root");
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

  fastify.get("/api/projects/:envId/files/cleanup", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const queryInput = environmentCleanupQuery.parse(request.query ?? {});
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    const plan = await buildEnvironmentCleanupPlan({
      environmentId: environment.id,
      rootPath: environment.root_path,
      targetPercent: queryInput.targetPercent,
      filters: {
        modifiedAfter: queryInput.modifiedAfter,
        modifiedBefore: queryInput.modifiedBefore,
        minSizeBytes: queryInput.minSizeBytes,
        maxSizeBytes: queryInput.maxSizeBytes
      }
    });
    const storage = await getWorkspaceStorageUsage({
      workspaceId: environment.workspace_id,
      workspaceRootPath: environment.workspace_root_path,
      actorUserId: request.user.id
    });

    return {
      ...plan,
      storage
    };
  });

  fastify.post("/api/projects/:envId/files/delete", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const body = environmentDeleteFilesBody.parse(request.body ?? {});
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    const unlinkedMissingPaths = await unlinkSourceFileLinksAtMissingEnvironmentPaths({
      environmentId: environment.id,
      environmentRootPath: environment.root_path,
      requestedPaths: body.paths
    });
    const targets = await resolveDeletionTargetsWithinRoot({
      rootPath: environment.root_path,
      requestedPaths: body.paths.filter((requestedPath) => !unlinkedMissingPaths.includes(requestedPath)),
      rootLabel: "environment"
    });
    await unlinkSourceFileLinksUnderEnvironmentPaths({
      environmentId: environment.id,
      localRelativePaths: targets.map((target) => target.relativePath)
    });
    const deletedTargets = await deleteResolvedTargets(targets);
    const deleted = {
      deletedCount: deletedTargets.deletedCount + unlinkedMissingPaths.length,
      deletedPaths: [...deletedTargets.deletedPaths, ...unlinkedMissingPaths]
    };
    const storage = await getWorkspaceStorageUsage({
      workspaceId: environment.workspace_id,
      workspaceRootPath: environment.workspace_root_path,
      actorUserId: request.user.id
    });

    return {
      ...deleted,
      storage
    };
  });

  fastify.post("/api/projects/:envId/files/upload", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = environmentParams.parse(request.params);
    const queryInput = environmentFileUploadQuery.parse(request.query);
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    const targetDirectory = await ensureDirectoryWithinRoot({
      rootPath: environment.root_path,
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
    await ensureSandboxWritablePath({
      rootPath: environment.root_path,
      targetPath: saved.absolutePath
    });

    return reply.status(201).send({ file: saved.file });
  });

  fastify.post("/api/projects/:envId/files/text", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = environmentParams.parse(request.params);
    const queryInput = environmentFileUploadQuery.parse(request.query);
    const body = environmentCreateTextFileBody.parse(request.body ?? {});
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    const file = await createTextFileWithinRoot({
      rootPath: environment.root_path,
      requestedDirectoryPath: queryInput.path,
      name: body.name,
      content: body.content
    });

    return reply.status(201).send({ file });
  });
}
