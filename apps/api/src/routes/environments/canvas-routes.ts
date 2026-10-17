import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { issueScopedAccessTicket, verifyScopedAccessTicket } from "../../services/auth/scoped-access-tickets.js";
import {
  assertCanvasBelongsToProject,
  createProjectCanvas,
  listProjectCanvases,
  resolveCanvasFile,
  updateProjectCanvas
} from "../../services/canvases/project-canvases.js";
import { getEnvironmentForUser } from "../../services/environments/environment-for-user.js";
import { sendCanvasFile } from "../files/canvas-file-response.js";
import { environmentParams } from "./shared.js";

const canvasParams = environmentParams.extend({
  canvasId: z.string().uuid()
});

const canvasBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  entryPath: z.string().trim().min(1).max(600).optional()
}).strict();

function parseCanvasPreviewParams(params: unknown): {
  envId: string;
  canvasId: string;
  ticket: string;
  requestedPath: string;
} {
  const parsed = canvasParams.extend({
    "*": z.string().trim().min(1)
  }).parse(params);
  const segments = parsed["*"]
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length < 1) {
    throw new Error("Canvas preview request must include a ticket.");
  }

  const [ticket, ...pathSegments] = segments;
  return {
    envId: parsed.envId,
    canvasId: parsed.canvasId,
    ticket,
    requestedPath: pathSegments.join("/")
  };
}

async function authenticateCanvasPreviewRequest(request: FastifyRequest, reply: FastifyReply) {
  let params;
  try {
    params = parseCanvasPreviewParams(request.params);
  } catch {
    return reply.status(404).send({ error: "Not Found" });
  }

  try {
    const payload = await verifyScopedAccessTicket(request.server, {
      ticket: params.ticket,
      scope: "project_canvas_preview",
      workspaceId: params.envId,
      sourceId: params.canvasId
    });
    request.user = {
      id: payload.userId,
      email: ""
    };
  } catch {
    return reply.status(401).send({ error: "Unauthorized" });
  }
}

async function loadCanvasForRequest(input: {
  envId: string;
  canvasId: string;
  userId: string;
}) {
  const environment = await getEnvironmentForUser(input.envId, input.userId);
  const canvas = await assertCanvasBelongsToProject({
    canvasId: input.canvasId,
    workspaceId: environment.workspace_id,
    environmentId: environment.id
  });

  return { environment, canvas };
}

export async function registerEnvironmentCanvasRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/projects/:envId/canvases", { preHandler: fastify.authenticate }, async (request) => {
    const params = environmentParams.parse(request.params);
    await getEnvironmentForUser(params.envId, request.user.id);
    return { items: await listProjectCanvases(params.envId) };
  });

  fastify.post("/api/projects/:envId/canvases", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = environmentParams.parse(request.params);
    const body = canvasBody.parse(request.body ?? {});
    const environment = await getEnvironmentForUser(params.envId, request.user.id);
    const canvas = await createProjectCanvas({
      workspaceId: environment.workspace_id,
      environmentId: environment.id,
      environmentRootPath: environment.root_path,
      name: body.name ?? "Canvas",
      createdByUserId: request.user.id,
      entryPath: body.entryPath
    });

    return reply.status(201).send({ canvas });
  });

  fastify.get("/api/projects/:envId/canvases/:canvasId", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = canvasParams.parse(request.params);
    const { canvas } = await loadCanvasForRequest({
      envId: params.envId,
      canvasId: params.canvasId,
      userId: request.user.id
    });
    if (!canvas) {
      return reply.status(404).send({ error: "Canvas not found" });
    }

    return { canvas };
  });

  fastify.patch("/api/projects/:envId/canvases/:canvasId", { preHandler: fastify.authenticate }, async (request) => {
    const params = canvasParams.parse(request.params);
    const body = canvasBody.parse(request.body ?? {});
    await loadCanvasForRequest({
      envId: params.envId,
      canvasId: params.canvasId,
      userId: request.user.id
    });

    return {
      canvas: await updateProjectCanvas({
        canvasId: params.canvasId,
        name: body.name,
        entryPath: body.entryPath
      })
    };
  });

  fastify.post("/api/projects/:envId/canvases/:canvasId/preview-ticket", { preHandler: fastify.authenticate }, async (request) => {
    const params = canvasParams.parse(request.params);
    await loadCanvasForRequest({
      envId: params.envId,
      canvasId: params.canvasId,
      userId: request.user.id
    });

    return issueScopedAccessTicket(fastify, {
      scope: "project_canvas_preview",
      userId: request.user.id,
      workspaceId: params.envId,
      sourceId: params.canvasId
    });
  });

  fastify.get(
    "/api/projects/:envId/canvases/:canvasId/preview/*",
    { preHandler: authenticateCanvasPreviewRequest },
    async (request, reply) => {
      const params = parseCanvasPreviewParams(request.params);
      const { environment, canvas } = await loadCanvasForRequest({
        envId: params.envId,
        canvasId: params.canvasId,
        userId: request.user.id
      });

      const file = await resolveCanvasFile({
        environmentRootPath: environment.root_path,
        canvas,
        requestedPath: params.requestedPath
      });
      // Agents rewrite canvases in place; a cached copy would hide the update from the live reload.
      return sendCanvasFile(reply, file, "private, no-cache");
    }
  );
}
