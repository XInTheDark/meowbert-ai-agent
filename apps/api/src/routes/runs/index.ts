import { runLiveFolderRoutes } from "./live-folders.js";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "../../lib/config.js";
import {
  RunApiForwardingError,
  forwardRunApiRequest,
  resolveRunLeaseHolderUrl,
  verifyRunLease
} from "../../services/runs/run-api-forwarding.js";

// Model requests carry the whole conversation, images included.
const RUN_API_BODY_LIMIT_BYTES = 64 * 1024 * 1024;

const callParams = z.object({ runId: z.string().uuid(), method: z.string().regex(/^[a-zA-Z]+\.[a-zA-Z]+$/) });
const modelParams = z.object({ runId: z.string().uuid() });

async function forward(request: FastifyRequest, reply: FastifyReply, runId: string, path: string) {
  try {
    const claims = verifyRunLease(request.headers.authorization, runId, config.security.jwtSecret);
    const holderUrl = await resolveRunLeaseHolderUrl(claims);
    // A model request stops upstream when its executor disconnects.
    const controller = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    const result = await forwardRunApiRequest({
      holderUrl,
      path,
      authorization: request.headers.authorization!,
      body: request.body,
      signal: controller.signal
    });
    return reply.code(result.status).send(result.body);
  } catch (error) {
    if (error instanceof RunApiForwardingError) {
      return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message } });
    }
    throw error;
  }
}

// The Run API for executors outside the control plane. The API checks the lease token and passes
// each call to the worker that holds the run's lease.
export const runApiRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(runLiveFolderRoutes);
  fastify.post("/api/runs/:runId/call/:method", { bodyLimit: RUN_API_BODY_LIMIT_BYTES }, async (request, reply) => {
    const params = callParams.parse(request.params);
    return forward(request, reply, params.runId, `/runs/${params.runId}/call/${params.method}`);
  });

  fastify.post("/api/runs/:runId/model/responses", { bodyLimit: RUN_API_BODY_LIMIT_BYTES }, async (request, reply) => {
    const params = modelParams.parse(request.params);
    return forward(request, reply, params.runId, `/runs/${params.runId}/model/responses`);
  });
};
