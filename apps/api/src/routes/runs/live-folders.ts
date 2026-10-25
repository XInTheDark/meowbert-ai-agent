import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { config } from "../../lib/config.js";
import { localLiveFolderConfig, listLocalLiveFolders } from "../../services/runs/local-live-folders.js";
import { verifyRunLease, RunApiForwardingError } from "../../services/runs/run-api-forwarding.js";

const runParams = z.object({ runId: z.string().uuid() });
const folderParams = runParams.extend({ linkId: z.string().uuid() });
const consentBody = z.object({ connectionId: z.string().regex(/^[a-f0-9]{64}$/), consent: z.literal(true) }).strict();

export const runLiveFolderRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook("onRequest", async (_request, reply) => {
    if (!config.localExecution.enabled) return reply.code(404).send({ error: "Local execution is disabled." });
    reply.header("cache-control", "no-store");
  });
  fastify.setErrorHandler((error, _request, reply) => {
    if (error instanceof RunApiForwardingError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    if (error instanceof z.ZodError) return reply.code(400).send({ error: "Invalid live-folder request." });
    // Provider failures must never put credential payloads into HTTP error messages.
    return reply.code(503).send({ error: "Google Drive live folders are unavailable. Check the connection and retry." });
  });
  fastify.get("/api/runs/:runId/live-folders", async (request) => {
    const { runId } = runParams.parse(request.params);
    return { folders: await listLocalLiveFolders(verifyRunLease(request.headers.authorization, runId, config.security.jwtSecret)) };
  });
  fastify.post("/api/runs/:runId/live-folders/:linkId/rclone-config", async (request) => {
    const { runId, linkId } = folderParams.parse(request.params);
    const body = consentBody.parse(request.body);
    return localLiveFolderConfig(verifyRunLease(request.headers.authorization, runId, config.security.jwtSecret), linkId, body.connectionId);
  });
};
