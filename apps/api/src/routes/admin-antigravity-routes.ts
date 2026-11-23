import type { FastifyPluginAsync } from "fastify";
import {
  antigravityLoginCancelInputSchema,
  antigravityLoginCompleteInputSchema,
  antigravityLoginStartInputSchema
} from "@meowbert/shared";
import { z } from "zod";
import { assertSuperAdmin } from "../services/admin/admin-settings.js";
import {
  listAdminAntigravityCredentials,
  removeAdminAntigravityCredential,
  selectAdminAntigravityCredential
} from "../services/admin/antigravity-credentials.js";
import {
  cancelAntigravityLogin,
  completeAntigravityLogin,
  startAntigravityLogin
} from "../services/admin/antigravity-login.js";
import {
  probeAntigravityCredentialModels,
  probeAntigravityCredentialUsage
} from "../services/admin/antigravity-probe.js";

const credentialParams = z.object({ credentialId: z.string().uuid() });

export function registerAdminAntigravityRoutes(fastify: Parameters<FastifyPluginAsync>[0]): void {
  fastify.get("/api/admin/antigravity/credentials", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    return { credentials: await listAdminAntigravityCredentials() };
  });

  fastify.post("/api/admin/antigravity/login/start", { preHandler: fastify.authenticate }, async (request, reply) => {
    await assertSuperAdmin(request.user.id);
    const input = antigravityLoginStartInputSchema.parse(request.body ?? {});
    const result = await startAntigravityLogin(request.user.id, input.label);
    return reply.code(201).send(result);
  });

  fastify.post("/api/admin/antigravity/login/complete", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const input = antigravityLoginCompleteInputSchema.parse(request.body);
    const credentials = await completeAntigravityLogin(request.user.id, input.loginSessionId, input.codeOrCallbackUrl);
    return { credentials };
  });

  fastify.post("/api/admin/antigravity/login/cancel", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const input = antigravityLoginCancelInputSchema.parse(request.body);
    await cancelAntigravityLogin(request.user.id, input.loginSessionId);
    return { ok: true };
  });

  fastify.post("/api/admin/antigravity/credentials/:credentialId/select", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { credentialId } = credentialParams.parse(request.params);
    return { credentials: await selectAdminAntigravityCredential(credentialId) };
  });

  fastify.delete("/api/admin/antigravity/credentials/:credentialId", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { credentialId } = credentialParams.parse(request.params);
    return { credentials: await removeAdminAntigravityCredential(credentialId) };
  });

  fastify.get("/api/admin/antigravity/credentials/:credentialId/models", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { credentialId } = credentialParams.parse(request.params);
    return await probeAntigravityCredentialModels(credentialId);
  });

  fastify.get("/api/admin/antigravity/credentials/:credentialId/usage", { preHandler: fastify.authenticate }, async (request) => {
    await assertSuperAdmin(request.user.id);
    const { credentialId } = credentialParams.parse(request.params);
    return await probeAntigravityCredentialUsage(credentialId);
  });
}
