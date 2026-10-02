import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { resolveRealPathWithinRoot } from "@meowbert/shared/server-security";
import { query } from "../lib/db.js";
import { deleteSelectedPaths } from "../services/files/delete-files.js";
import { listDirectory } from "../services/files/directory-listing.js";
import { listDirectorySizeEntries } from "../services/files/file-browser-metadata.js";
import { resolveBatchDownloadEntries, resolveFileDownload } from "../services/files/file-download.js";
import { readFilePreview } from "../services/files/file-preview.js";
import { resolveSelectedPathsWithinRoot } from "../services/files/selected-paths.js";
import { getWorkspaceStorageUsage } from "../services/workspaces/workspace-storage-usage.js";
import { assertWorkspaceMember } from "../services/workspaces/workspace-access.js";
import { ensureWorkspaceStorageRoot } from "../services/workspaces/workspace-storage.js";
import { sendBatchDownload, sendFileDownload } from "./files/file-download-replies.js";
import {
  batchFileDownloadQuery,
  deleteFilesBody,
  fileQuery,
  fileUploadQuery,
  requiredFileQuery
} from "./files/file-route-schemas.js";
import { receiveFileUpload } from "./files/file-upload.js";

const workspaceParamsSchema = z.object({
  wsId: z.string().uuid()
});

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

export const workspaceFileRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/api/workspaces/:wsId/files", { preHandler: fastify.authenticate }, async (request) => {
    const params = workspaceParamsSchema.parse(request.params);
    const queryInput = fileQuery.parse(request.query);
    const workspace = await getWorkspaceForUser(params.wsId, request.user.id);
    return listDirectory(await resolveRealPathWithinRoot(workspace.root_path, queryInput.path));
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
    const queryInput = fileQuery.parse(request.query);
    const workspace = await getWorkspaceForUser(params.wsId, request.user.id);

    return listDirectorySizeEntries({
      rootPath: workspace.root_path,
      requestedPath: queryInput.path
    });
  });

  fastify.get("/api/workspaces/:wsId/files/content", { preHandler: fastify.authenticate }, async (request) => {
    const params = workspaceParamsSchema.parse(request.params);
    const queryInput = requiredFileQuery.parse(request.query);
    const workspace = await getWorkspaceForUser(params.wsId, request.user.id);
    return readFilePreview(workspace.root_path, queryInput.path);
  });

  fastify.get("/api/workspaces/:wsId/files/download", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = workspaceParamsSchema.parse(request.params);
    const queryInput = requiredFileQuery.parse(request.query);
    const workspace = await getWorkspaceForUser(params.wsId, request.user.id);
    return sendFileDownload(request, reply, await resolveFileDownload(workspace.root_path, queryInput.path));
  });

  fastify.get("/api/workspaces/:wsId/files/download/batch", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = workspaceParamsSchema.parse(request.params);
    const queryInput = batchFileDownloadQuery.parse(request.query);
    const workspace = await getWorkspaceForUser(params.wsId, request.user.id);
    const entries = await resolveBatchDownloadEntries({
      rootPath: workspace.root_path,
      requestedPaths: queryInput.path,
      currentDirectory: queryInput.cwd,
      rootLabel: "workspace"
    });
    return sendBatchDownload(request, reply, entries);
  });

  fastify.post("/api/workspaces/:wsId/files/delete", { preHandler: fastify.authenticate }, async (request) => {
    const params = workspaceParamsSchema.parse(request.params);
    const body = deleteFilesBody.parse(request.body ?? {});
    const workspace = await getWorkspaceForUser(params.wsId, request.user.id);
    const targets = await resolveSelectedPathsWithinRoot({
      rootPath: workspace.root_path,
      requestedPaths: body.paths,
      rootLabel: "workspace",
      action: "delete"
    });
    const deleted = await deleteSelectedPaths(targets);
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
    const queryInput = fileUploadQuery.parse(request.query);
    const workspace = await getWorkspaceForUser(params.wsId, request.user.id);
    const saved = await receiveFileUpload(request, {
      rootPath: workspace.root_path,
      query: queryInput,
      storage: { workspaceId: workspace.id, workspaceRootPath: workspace.root_path, actorUserId: request.user.id }
    });
    return reply.status(201).send({ file: saved.file });
  });
};
