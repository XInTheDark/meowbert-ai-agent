import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { ScopedAccessTicketError } from "../services/auth/scoped-access-tickets.js";
import {
  getTaskLiveSyncStatusByTaskPath,
  listTaskLiveSyncFileSummaries,
  pullTaskLiveSyncFileByTaskPath,
  pushTaskLiveSyncFileByTaskPath,
  ensureTaskSourceFolderMounts,
  releaseTaskSourceFolderMounts
} from "../services/source-file-links/service.js";
import {
  browseWorkspaceSource,
  downloadWorkspaceSourceFile,
  resolveWorkspaceSourcePath,
  searchWorkspaceSource
} from "../services/sources/source-operations.js";
import {
  extractBearerToken,
  internalLiveSyncMutationBody,
  internalLiveSyncStatusQuery,
  internalLiveSyncTaskParams,
  requireLiveSyncProxyAccess,
  requireSourceProxyAccess,
  sourceBrowseQuery,
  sourcePathQuery,
  sourceSearchQuery
} from "./source-route-shared.js";

function registerInternalSourceProxyRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get("/api/internal/sources/:sourceId/search", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120) }).parse(request.params);
    const queryInput = sourceSearchQuery.parse(request.query ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return searchWorkspaceSource({
      workspaceId: payload.workspaceId,
      sourceId: params.sourceId,
      query: queryInput.q,
      folderId: queryInput.folderId ?? null,
      limit: queryInput.limit
    });
  });

  fastify.get("/api/internal/sources/:sourceId/path", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120) }).parse(request.params);
    const queryInput = sourcePathQuery.parse(request.query ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return resolveWorkspaceSourcePath({
      workspaceId: payload.workspaceId,
      sourceId: params.sourceId,
      path: queryInput.path,
      folderId: queryInput.folderId ?? null
    });
  });

  fastify.get("/api/internal/sources/:sourceId/browse", async (request) => {
    const params = z.object({ sourceId: z.string().min(1).max(120) }).parse(request.params);
    const queryInput = sourceBrowseQuery.parse(request.query ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    return browseWorkspaceSource({
      workspaceId: payload.workspaceId,
      sourceId: params.sourceId,
      folderId: queryInput.folderId ?? null,
      limit: queryInput.limit
    });
  });

  fastify.get("/api/internal/sources/:sourceId/file", async (request, reply) => {
    const params = z.object({ sourceId: z.string().min(1).max(120) }).parse(request.params);
    const queryInput = z.object({ itemId: z.string().min(1).max(400) }).parse(request.query ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireSourceProxyAccess({ fastify, ticket, sourceId: params.sourceId });
    if (!payload.workspaceId) {
      throw new ScopedAccessTicketError();
    }

    const download = await downloadWorkspaceSourceFile({
      workspaceId: payload.workspaceId,
      sourceId: params.sourceId,
      itemId: queryInput.itemId
    });
    if (!download.response.body) {
      throw new Error("Source download returned an empty response body.");
    }

    reply.header("content-type", download.mimeType ?? "application/octet-stream");
    reply.header("x-source-file-name", encodeURIComponent(download.fileName));
    if (typeof download.sizeBytes === "number" && Number.isFinite(download.sizeBytes)) {
      reply.header("content-length", String(download.sizeBytes));
    }
    return reply.send(Readable.fromWeb(download.response.body as unknown as NodeReadableStream));
  });
}

function registerInternalLiveSyncRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.post("/api/internal/live-sync/tasks/:taskId/mounts", async (request) => {
    const params = internalLiveSyncTaskParams.parse(request.params);
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireLiveSyncProxyAccess({ fastify, ticket, taskId: params.taskId });
    const mountPaths = await ensureTaskSourceFolderMounts({ taskId: params.taskId, consumerId: `${params.taskId}:${payload.userId ?? "system"}` });
    return { ok: true, mountPaths };
  });
  fastify.delete("/api/internal/live-sync/tasks/:taskId/mounts", async (request) => {
    const params = internalLiveSyncTaskParams.parse(request.params);
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireLiveSyncProxyAccess({ fastify, ticket, taskId: params.taskId });
    await releaseTaskSourceFolderMounts({ taskId: params.taskId, consumerId: `${params.taskId}:${payload.userId ?? "system"}` });
    return { ok: true };
  });
  fastify.get("/api/internal/live-sync/tasks/:taskId/files", async (request) => {
    const params = internalLiveSyncTaskParams.parse(request.params);
    const ticket = extractBearerToken(request.headers.authorization);
    await requireLiveSyncProxyAccess({ fastify, ticket, taskId: params.taskId });

    return {
      items: await listTaskLiveSyncFileSummaries({
        taskId: params.taskId
      })
    };
  });

  fastify.get("/api/internal/live-sync/tasks/:taskId/status", async (request) => {
    const params = internalLiveSyncTaskParams.parse(request.params);
    const queryInput = internalLiveSyncStatusQuery.parse(request.query ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    await requireLiveSyncProxyAccess({ fastify, ticket, taskId: params.taskId });

    return getTaskLiveSyncStatusByTaskPath({
      taskId: params.taskId,
      taskRelativePath: queryInput.path
    });
  });

  fastify.post("/api/internal/live-sync/tasks/:taskId/pull", async (request) => {
    const params = internalLiveSyncTaskParams.parse(request.params);
    const body = internalLiveSyncMutationBody.parse(request.body ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireLiveSyncProxyAccess({ fastify, ticket, taskId: params.taskId });

    return pullTaskLiveSyncFileByTaskPath({
      taskId: params.taskId,
      actorUserId: payload.userId,
      taskRelativePath: body.path,
      force: body.force
    });
  });

  fastify.post("/api/internal/live-sync/tasks/:taskId/push", async (request) => {
    const params = internalLiveSyncTaskParams.parse(request.params);
    const body = internalLiveSyncMutationBody.parse(request.body ?? {});
    const ticket = extractBearerToken(request.headers.authorization);
    const payload = await requireLiveSyncProxyAccess({ fastify, ticket, taskId: params.taskId });

    return pushTaskLiveSyncFileByTaskPath({
      taskId: params.taskId,
      actorUserId: payload.userId,
      taskRelativePath: body.path,
      force: body.force
    });
  });
}

export function registerInternalSourceRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  registerInternalSourceProxyRoutes(fastify);
  registerInternalLiveSyncRoutes(fastify);
}
