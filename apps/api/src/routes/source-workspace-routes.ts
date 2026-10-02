import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { query } from "../lib/db.js";
import { getEnvironmentForUser } from "../services/environments/environment-for-user.js";
import { workspaceParams } from "./environments/shared.js";
import { beginWorkspaceSourceOAuth } from "../services/sources/oauth-flow.js";
import {
  getSourceProviderSettings,
  isSourceProviderReady,
  listSourceProviderSettings
} from "../services/sources/provider-settings.js";
import {
  deleteWorkspaceSourceConnection,
  listWorkspaceSourceConnections,
  getWorkspaceSourceConnection,
  sourceConnectionCanWrite
} from "../services/sources/workspace-source-connections.js";
import { attachWorkspaceSource } from "../services/sources/source-attachments.js";
import {
  browseWorkspaceSource,
  listAvailableWorkspaceSources,
  resolveWorkspaceSourcePath,
  searchWorkspaceSource
} from "../services/sources/source-operations.js";
import { connectWorkspaceRcloneSource } from "../services/sources/providers/rclone.js";
import { assertWorkspaceMember, assertWorkspaceOwner } from "../services/workspaces/workspace-access.js";
import {
  sourceBrowseQuery,
  sourceParams,
  sourcePathQuery,
  sourceSearchQuery
} from "./source-route-shared.js";

const sourceConnectStartBody = z.object({
  returnOrigin: z.string().optional()
}).strict().optional();

const sourceAttachBody = z.object({
  environmentId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  itemId: z.string().min(1).max(1200).optional(),
  url: z.string().url().optional(),
  fileMode: z.enum(["copy", "live_sync"]).optional(),
  googleWorkspaceMode: z.enum(["office", "direct"]).optional(),
  destinationPath: z.string().max(1200).nullable().optional(),
  createDirectories: z.boolean().optional()
}).strict();

const sourceRcloneConfigBody = z.object({
  rcloneConfig: z.string().min(1).max(250_000),
  remoteName: z.string().min(1).max(200),
  baseDirectory: z.string().max(1200).nullable().optional()
}).strict();

async function assertWorkspaceSourceReadyForUse(input: {
  workspaceId: string;
  source: ReturnType<typeof listAvailableWorkspaceSources>[number];
}) {
  const settings = await getSourceProviderSettings(input.source.provider);
  if (!isSourceProviderReady(settings, { requiresCredentials: input.source.requiresAdminCredentials })) {
    throw new Error(
      input.source.requiresAdminCredentials
        ? "This source provider is not configured by the server admin."
        : "This source is not enabled by the server admin."
    );
  }

  if (!input.source.requiresWorkspaceConnection) {
    return;
  }

  const connection = await getWorkspaceSourceConnection(input.workspaceId, input.source.provider);
  if (!connection) {
    throw new Error("This workspace has not connected the requested source yet.");
  }
}

async function validateOptionalTaskAttachmentTarget(input: {
  taskId: string | null;
  workspaceId: string;
  environmentId: string;
}): Promise<void> {
  if (!input.taskId) {
    return;
  }

  const taskRes = await query<{
    workspace_id: string;
    environment_id: string;
  }>(
    `SELECT workspace_id, environment_id
       FROM tasks
      WHERE id = $1
      LIMIT 1`,
    [input.taskId]
  );

  if ((taskRes.rowCount ?? 0) === 0) {
    return;
  }

  const task = taskRes.rows[0];
  if (task.workspace_id !== input.workspaceId || task.environment_id !== input.environmentId) {
    throw new Error("Task does not belong to the selected project.");
  }
}

function registerSourceCatalogRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get(
    "/api/workspaces/:wsId/sources",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = workspaceParams.parse(request.params);
      await assertWorkspaceMember(params.wsId, request.user.id);

      const [memberRoleRes, providerSettings, connections] = await Promise.all([
        query<{ role: string }>(
          `SELECT role
             FROM workspace_members
            WHERE workspace_id = $1
              AND user_id = $2
            LIMIT 1`,
          [params.wsId, request.user.id]
        ),
        listSourceProviderSettings(),
        listWorkspaceSourceConnections(params.wsId)
      ]);

      const canManage = memberRoleRes.rows[0]?.role === "owner";
      const settingsByProvider = new Map(providerSettings.map((entry) => [entry.provider, entry]));
      const connectionsByProvider = new Map(connections.map((entry) => [entry.provider, entry]));

      return {
        canManage,
        sources: listAvailableWorkspaceSources().map((source) => {
          const providerSetting = settingsByProvider.get(source.provider) ?? null;
          const connection = connectionsByProvider.get(source.provider) ?? null;
          const isAdminConfigured = isSourceProviderReady(providerSetting, {
            requiresCredentials: source.requiresAdminCredentials
          });
          const isConnected = source.requiresWorkspaceConnection
            ? connection !== null
            : providerSetting?.enabled === true && isAdminConfigured;

          return {
            id: source.manifest.id,
            name: source.manifest.name,
            description: source.manifest.description,
            provider: source.provider,
            supportsAttachments: source.supportsAttachments,
            supportsLiveSync: source.supportsLiveSync,
            attachmentMode: source.attachmentMode,
            requiresAdminCredentials: source.requiresAdminCredentials,
            requiresWorkspaceConnection: source.requiresWorkspaceConnection,
            admin: {
              enabled: providerSetting?.enabled === true,
              configured: isAdminConfigured
            },
            connection: source.requiresWorkspaceConnection && connection
              ? {
                  connected: true,
                  accountLabel: connection.accountLabel,
                  connectedAt: connection.connectedAt,
                  canWrite: sourceConnectionCanWrite(connection)
                }
              : {
                  connected: isConnected,
                  accountLabel: null,
                  connectedAt: null,
                  canWrite: false
                }
          };
        })
      };
    }
  );
}

function registerSourceConnectionRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.post(
    "/api/workspaces/:wsId/sources/:sourceId/connect/start",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = sourceParams.parse(request.params);
      const body = sourceConnectStartBody.parse(request.body ?? undefined);
      await assertWorkspaceOwner(params.wsId, request.user.id);

      const source = listAvailableWorkspaceSources().find((entry) => entry.manifest.id === params.sourceId);
      if (!source) {
        throw new Error(`Source not found: ${params.sourceId}`);
      }
      if (!source.requiresWorkspaceConnection) {
        throw new Error(`${source.manifest.name} does not require workspace authentication.`);
      }

      const started = await beginWorkspaceSourceOAuth({
        workspaceId: params.wsId,
        userId: request.user.id,
        sourceId: params.sourceId,
        returnOrigin: body?.returnOrigin ?? null
      });
      reply.header("set-cookie", started.setCookieHeader);
      return {
        authorizeUrl: started.authorizeUrl,
        expiresAt: started.expiresAt
      };
    }
  );

  fastify.delete(
    "/api/workspaces/:wsId/sources/:sourceId",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = sourceParams.parse(request.params);
      await assertWorkspaceOwner(params.wsId, request.user.id);

      const source = listAvailableWorkspaceSources().find((entry) => entry.manifest.id === params.sourceId);
      if (!source) {
        throw new Error(`Source not found: ${params.sourceId}`);
      }
      if (!source.requiresWorkspaceConnection) {
        return reply.send({ ok: true });
      }

      await deleteWorkspaceSourceConnection(params.wsId, source.provider);
      return reply.send({ ok: true });
    }
  );

  fastify.put(
    "/api/workspaces/:wsId/sources/:sourceId/config",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.parse(request.params);
      const body = sourceRcloneConfigBody.parse(request.body ?? {});
      await assertWorkspaceOwner(params.wsId, request.user.id);

      const source = listAvailableWorkspaceSources().find((entry) => entry.manifest.id === params.sourceId);
      if (!source) {
        throw new Error(`Source not found: ${params.sourceId}`);
      }
      if (source.provider !== "rclone") {
        throw new Error(`${source.manifest.name} does not use manual source configuration.`);
      }
      await assertWorkspaceSourceReadyForUse({
        workspaceId: params.wsId,
        source: {
          ...source,
          requiresWorkspaceConnection: false
        }
      });

      const connection = await connectWorkspaceRcloneSource({
        workspaceId: params.wsId,
        userId: request.user.id,
        rcloneConfig: body.rcloneConfig,
        remoteName: body.remoteName,
        baseDirectory: body.baseDirectory ?? null
      });

      return {
        sourceId: params.sourceId,
        connected: true,
        accountLabel: connection.accountLabel
      };
    }
  );
}

function registerSourceBrowseRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get(
    "/api/workspaces/:wsId/sources/:sourceId/search",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.parse(request.params);
      const queryInput = sourceSearchQuery.parse(request.query ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      return searchWorkspaceSource({
        workspaceId: params.wsId,
        sourceId: params.sourceId,
        query: queryInput.q,
        folderId: queryInput.folderId ?? null,
        limit: queryInput.limit
      });
    }
  );

  fastify.get(
    "/api/workspaces/:wsId/sources/:sourceId/path",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.parse(request.params);
      const queryInput = sourcePathQuery.parse(request.query ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      return resolveWorkspaceSourcePath({
        workspaceId: params.wsId,
        sourceId: params.sourceId,
        path: queryInput.path,
        folderId: queryInput.folderId ?? null
      });
    }
  );

  fastify.get(
    "/api/workspaces/:wsId/sources/:sourceId/browse",
    { preHandler: fastify.authenticate },
    async (request) => {
      const params = sourceParams.parse(request.params);
      const queryInput = sourceBrowseQuery.parse(request.query ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);

      return browseWorkspaceSource({
        workspaceId: params.wsId,
        sourceId: params.sourceId,
        folderId: queryInput.folderId ?? null,
        limit: queryInput.limit
      });
    }
  );
}

function registerSourceAttachmentRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.post(
    "/api/workspaces/:wsId/sources/:sourceId/attach",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const params = sourceParams.parse(request.params);
      const body = sourceAttachBody.parse(request.body ?? {});
      await assertWorkspaceMember(params.wsId, request.user.id);
      const source = listAvailableWorkspaceSources().find((entry) => entry.manifest.id === params.sourceId);
      if (!source) {
        throw new Error(`Source not found: ${params.sourceId}`);
      }
      await assertWorkspaceSourceReadyForUse({
        workspaceId: params.wsId,
        source
      });

      let environment = null;
      if (source.attachmentMode === "file") {
        if (!body.environmentId) {
          throw new Error("An environment is required for this source attachment.");
        }

        environment = await getEnvironmentForUser(body.environmentId, request.user.id);
        if (environment.workspace_id !== params.wsId) {
          throw new Error("Environment does not belong to this workspace.");
        }

        await validateOptionalTaskAttachmentTarget({
          taskId: body.taskId ?? null,
          workspaceId: params.wsId,
          environmentId: environment.id
        });
      }

      const attachment = await attachWorkspaceSource({
        workspaceId: params.wsId,
        actorUserId: request.user.id,
        sourceId: params.sourceId,
        environmentId: body.environmentId ?? null,
        environmentRootPath: environment?.root_path ?? null,
        workspaceRootPath: environment?.workspace_root_path ?? null,
        taskId: body.taskId ?? null,
        itemId: body.itemId ?? null,
        url: body.url ?? null,
        fileMode: body.fileMode ?? "copy",
        googleWorkspaceMode: body.googleWorkspaceMode ?? "office",
        destinationPath: body.destinationPath ?? null,
        createDirectories: body.createDirectories
      });

      return reply.status(201).send({ attachment });
    }
  );
}

export function registerWorkspaceSourceRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  registerSourceCatalogRoutes(fastify);
  registerSourceConnectionRoutes(fastify);
  registerSourceBrowseRoutes(fastify);
  registerSourceAttachmentRoutes(fastify);
}
