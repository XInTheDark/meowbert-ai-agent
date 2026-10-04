import type { FastifyInstance } from "fastify";
import { ensureSandboxWritablePath } from "@meowbert/shared";
import { buildEnvironmentCleanupPlan } from "../../services/environments/environment-file-cleanup.js";
import { getEnvironmentForUser, type EnvironmentForUser } from "../../services/environments/environment-for-user.js";
import { listProjectDirectory } from "../../services/environments/project-directory-listing.js";
import { deleteProjectFiles } from "../../services/environments/project-file-deletion.js";
import { createTextFileWithinRoot } from "../../services/files/create-text-file.js";
import { resolveBatchDownloadEntries, resolveFileDownload } from "../../services/files/file-download.js";
import { readFilePreview } from "../../services/files/file-preview.js";
import { getWorkspaceStorageUsage } from "../../services/workspaces/workspace-storage-usage.js";
import { sendBatchDownload, sendFileDownload } from "../files/file-download-replies.js";
import {
  batchFileDownloadQuery,
  createTextFileBody,
  deleteFilesBody,
  fileQuery,
  fileUploadQuery,
  requiredFileQuery
} from "../files/file-route-schemas.js";
import { receiveFileUpload } from "../files/file-upload.js";
import { environmentCleanupQuery, environmentParams } from "./shared.js";

async function loadWorkspaceStorage(environment: EnvironmentForUser) {
  return getWorkspaceStorageUsage({
    workspaceId: environment.workspace_id,
    workspaceRootPath: environment.workspace_root_path
  });
}

export async function registerEnvironmentFileRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/projects/:envId/files", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const queryInput = fileQuery.parse(request.query);
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    return listProjectDirectory({
      environmentId: environment.id,
      rootPath: environment.root_path,
      jsonPayload: environment.json_payload,
      requestedPath: queryInput.path
    });
  });

  fastify.get("/api/projects/:envId/files/storage", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    return { storage: await loadWorkspaceStorage(environment) };
  });

  fastify.get("/api/projects/:envId/files/content", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const queryInput = requiredFileQuery.parse(request.query);
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    return readFilePreview(environment.root_path, queryInput.path);
  });

  fastify.get("/api/projects/:envId/files/download", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = environmentParams.parse(request.params);
    const queryInput = requiredFileQuery.parse(request.query);
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    return sendFileDownload(request, reply, await resolveFileDownload(environment.root_path, queryInput.path));
  });

  fastify.get("/api/projects/:envId/files/download/batch", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = environmentParams.parse(request.params);
    const queryInput = batchFileDownloadQuery.parse(request.query);
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    const entries = await resolveBatchDownloadEntries({
      rootPath: environment.root_path,
      requestedPaths: queryInput.path,
      currentDirectory: queryInput.cwd,
      rootLabel: "environment"
    });
    return sendBatchDownload(request, reply, entries);
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

    return {
      ...plan,
      storage: await loadWorkspaceStorage(environment)
    };
  });

  fastify.post("/api/projects/:envId/files/delete", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    const body = deleteFilesBody.parse(request.body ?? {});
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    const deleted = await deleteProjectFiles({
      environmentId: environment.id,
      rootPath: environment.root_path,
      requestedPaths: body.paths
    });

    return {
      ...deleted,
      storage: await loadWorkspaceStorage(environment)
    };
  });

  fastify.post("/api/projects/:envId/files/upload", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = environmentParams.parse(request.params);
    const queryInput = fileUploadQuery.parse(request.query);
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    const saved = await receiveFileUpload(request, { rootPath: environment.root_path, query: queryInput });
    await ensureSandboxWritablePath({
      rootPath: environment.root_path,
      targetPath: saved.absolutePath
    });

    return reply.status(201).send({ file: saved.file });
  });

  fastify.post("/api/projects/:envId/files/text", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = environmentParams.parse(request.params);
    const queryInput = fileUploadQuery.parse(request.query);
    const body = createTextFileBody.parse(request.body ?? {});
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
