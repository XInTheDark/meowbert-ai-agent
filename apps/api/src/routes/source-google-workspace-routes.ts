import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  ScopedAccessTicketError,
  verifyScopedAccessTicket
} from "../services/auth/scoped-access-tickets.js";
import { authorizeGoogleWorkspaceReference } from "../services/sources/google-workspace/reference-access.js";
import { authorizeGoogleWorkspaceRequest } from "../services/sources/google-workspace/proxy-policy.js";
import { executeGoogleWorkspaceProxyRequest } from "../services/sources/google-workspace/proxy-request.js";
import { resolveGoogleWorkspaceReference } from "../services/sources/google-workspace/reference-resolution.js";

const routeParams = z.object({ sourceId: z.string().min(1).max(120) });
const resolveBody = z.object({ itemReference: z.string().min(1).max(1_200) }).strict();
const requestBody = z.object({
  referenceToken: z.string().min(1).max(20_000),
  method: z.string().min(1).max(20),
  url: z.string().url().max(8_000),
  headers: z.record(z.string()).default({}),
  bodyBase64: z.string().max(20_000_000).nullable().default(null)
}).strict();

function extractBearerToken(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const match = raw?.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new ScopedAccessTicketError();
  }
  return match[1];
}

export function registerSourceGoogleWorkspaceRoutes(fastify: FastifyInstance): void {
  fastify.post(
    "/api/internal/sources/:sourceId/google-workspace/resolve",
    async (request) => {
      const params = routeParams.parse(request.params);
      const body = resolveBody.parse(request.body ?? {});
      const ticket = await verifyScopedAccessTicket(fastify, {
        ticket: extractBearerToken(request.headers.authorization),
        scope: "source_reference_proxy",
        sourceId: params.sourceId
      });
      if (!ticket.taskId || !ticket.workspaceId) throw new ScopedAccessTicketError();
      const reference = await resolveGoogleWorkspaceReference({
        taskId: ticket.taskId,
        workspaceId: ticket.workspaceId,
        sourceId: params.sourceId,
        itemReference: body.itemReference
      });
      return { reference };
    }
  );
  fastify.post(
    "/api/internal/sources/:sourceId/google-workspace/request",
    async (request) => {
      const params = routeParams.parse(request.params);
      const body = requestBody.parse(request.body ?? {});
      const ticket = await verifyScopedAccessTicket(fastify, {
        ticket: extractBearerToken(request.headers.authorization),
        scope: "source_reference_proxy",
        sourceId: params.sourceId
      });
      const reference = await authorizeGoogleWorkspaceReference({
        referenceToken: body.referenceToken,
        routeSourceId: params.sourceId,
        ticket
      });
      const authorizedRequest = authorizeGoogleWorkspaceRequest({
        request: body,
        reference
      });
      return executeGoogleWorkspaceProxyRequest({
        workspaceId: reference.scope.workspaceId,
        request: authorizedRequest,
        reference
      });
    }
  );
}
