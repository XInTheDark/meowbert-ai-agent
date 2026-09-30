import { assertSourceProviderRuntimeEnabled } from "@meowbert/shared";
import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import {
  listSourceProviderSettings,
  sanitizeSourceProviderSettingsForApi,
  upsertSourceProviderSettings
} from "../services/sources/provider-settings.js";
import { listAvailableWorkspaceSources } from "../services/sources/source-operations.js";
import { SOURCE_PROVIDERS } from "../services/sources/source-types.js";

const sourceProviderParams = z.object({
  provider: z.enum(SOURCE_PROVIDERS)
});

const updateSourceProviderBody = z.object({
  enabled: z.boolean().optional(),
  clientId: z.string().nullable().optional(),
  clientSecret: z.string().nullable().optional()
}).strict();

function buildAdminSourceSummary() {
  return async () => {
    const [catalog, settings] = await Promise.all([
      Promise.resolve(listAvailableWorkspaceSources()),
      listSourceProviderSettings()
    ]);
    const settingsByProvider = new Map(settings.map((entry) => [entry.provider, entry]));

    return catalog.map((source) => {
      const setting = settingsByProvider.get(source.provider);
      return {
        ...sanitizeSourceProviderSettingsForApi(
          setting ?? {
            provider: source.provider,
            enabled: false,
            clientId: null,
            clientSecret: null,
            updatedByUserId: null,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString()
          },
          { includeCredentials: true }
        ),
        id: source.manifest.id,
        name: source.manifest.name,
        description: source.manifest.description,
        requiresAdminCredentials: source.requiresAdminCredentials
      };
    });
  };
}

export const adminSourceRoutes: FastifyPluginAsync = async (fastify) => {
  const listAdminSources = buildAdminSourceSummary();

  fastify.get("/api/admin/sources", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return {
      sources: await listAdminSources()
    };
  });

  fastify.patch("/api/admin/sources/:provider", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const params = sourceProviderParams.parse(request.params);
    assertSourceProviderRuntimeEnabled(params.provider);
    const body = updateSourceProviderBody.parse(request.body ?? {});
    const updated = await upsertSourceProviderSettings({
      provider: params.provider,
      enabled: body.enabled,
      clientId: body.clientId,
      clientSecret: body.clientSecret,
      updatedByUserId: request.user.id
    });

    const sources = await listAdminSources();
    const source = sources.find((entry) => entry.provider === params.provider);

    return {
      source: source ?? sanitizeSourceProviderSettingsForApi(updated, { includeCredentials: true })
    };
  });
};
