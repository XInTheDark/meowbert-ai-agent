import fs from "node:fs";
import { Readable } from "node:stream";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { issueScopedAccessTicket, verifyScopedAccessTicket } from "../../services/auth/scoped-access-tickets.js";
import { getFileContentType } from "../../services/files/file-content-type.js";
import {
  assertCanvasBelongsToProject,
  createProjectCanvas,
  getProjectCanvas,
  listProjectCanvases,
  resolveCanvasFile,
  updateProjectCanvas,
  type ProjectCanvasRuntimeMode
} from "../../services/canvases/project-canvases.js";
import {
  getCanvasDevServerStatus,
  proxyCanvasDevServer,
  startCanvasDevServer,
  stopCanvasDevServer
} from "../../services/canvases/canvas-dev-server.js";
import { getEnvironmentForUser } from "../../services/environments/environment-for-user.js";
import { environmentParams } from "./shared.js";

const canvasParams = environmentParams.extend({
  canvasId: z.string().uuid()
});

const canvasBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  entryPath: z.string().trim().min(1).max(600).optional(),
  runtimeMode: z.enum(["static", "dev_server"]).optional(),
  devServer: z.record(z.string(), z.unknown()).optional()
}).strict();

function buildBridgeScript(canvasId: string): string {
  return [
    "(function () {",
    "  function run(input) {",
    "    var payload = input && typeof input === 'object' ? input : {};",
    "    var userGesture = typeof navigator.userActivation === 'undefined' ? true : navigator.userActivation.isActive === true;",
    "    window.parent.postMessage({",
    "      type: 'meowbert-canvas-run',",
    `      canvasId: ${JSON.stringify(canvasId)},`,
    "      prompt: typeof payload.prompt === 'string' ? payload.prompt : '',",
    "      title: typeof payload.title === 'string' ? payload.title : null,",
    "      userGesture: userGesture",
    "    }, '*');",
    "  }",
    "  window.meowbert = Object.freeze({ run: run });",
    "}());"
  ].join("\n");
}

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
      name: body.name ?? "Interactive Canvas",
      createdByUserId: request.user.id,
      runtimeMode: body.runtimeMode as ProjectCanvasRuntimeMode | undefined,
      entryPath: body.entryPath,
      devServer: body.devServer
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
        entryPath: body.entryPath,
        runtimeMode: body.runtimeMode as ProjectCanvasRuntimeMode | undefined,
        devServer: body.devServer
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

  fastify.get("/api/projects/:envId/canvases/:canvasId/dev-server/status", { preHandler: fastify.authenticate }, async (request) => {
    const params = canvasParams.parse(request.params);
    await loadCanvasForRequest({
      envId: params.envId,
      canvasId: params.canvasId,
      userId: request.user.id
    });
    return getCanvasDevServerStatus(params.canvasId);
  });

  fastify.post("/api/projects/:envId/canvases/:canvasId/dev-server/start", { preHandler: fastify.authenticate }, async (request) => {
    const params = canvasParams.parse(request.params);
    const { environment, canvas } = await loadCanvasForRequest({
      envId: params.envId,
      canvasId: params.canvasId,
      userId: request.user.id
    });
    return startCanvasDevServer({
      canvas,
      ownerUserId: request.user.id,
      environmentRootPath: environment.root_path,
      workspaceRootPath: environment.workspace_root_path,
      runAsRoot: environment.workspace_run_as_root
    });
  });

  fastify.post("/api/projects/:envId/canvases/:canvasId/dev-server/stop", { preHandler: fastify.authenticate }, async (request) => {
    const params = canvasParams.parse(request.params);
    await loadCanvasForRequest({
      envId: params.envId,
      canvasId: params.canvasId,
      userId: request.user.id
    });
    return stopCanvasDevServer(params.canvasId);
  });

  fastify.all(
    "/api/projects/:envId/canvases/:canvasId/preview/*",
    { preHandler: authenticateCanvasPreviewRequest },
    async (request, reply) => {
      const params = parseCanvasPreviewParams(request.params);
      const { environment, canvas } = await loadCanvasForRequest({
        envId: params.envId,
        canvasId: params.canvasId,
        userId: request.user.id
      });

      if (params.requestedPath === "meowbert-canvas.js") {
        reply.header("Content-Type", "application/javascript; charset=utf-8");
        reply.header("Cache-Control", "private, max-age=60");
        return reply.send(buildBridgeScript(params.canvasId));
      }

      if (canvas.runtimeMode === "dev_server") {
        const proxied = await proxyCanvasDevServer({
          canvasId: params.canvasId,
          requestedPath: params.requestedPath || "/",
          method: request.method,
          headers: request.headers
        });
        reply.status(proxied.status);
        proxied.headers.forEach((value, key) => {
          if (!["content-encoding", "content-length", "connection"].includes(key.toLowerCase())) {
            reply.header(key, value);
          }
        });
        return proxied.body
          ? reply.send(Readable.fromWeb(proxied.body as never))
          : reply.send();
      }

      const file = await resolveCanvasFile({
        environmentRootPath: environment.root_path,
        canvas,
        requestedPath: params.requestedPath
      });
      reply.header("Content-Type", getFileContentType(file.absolutePath));
      reply.header("Content-Length", String(file.sizeBytes));
      reply.header("Cache-Control", "private, max-age=60");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Referrer-Policy", "no-referrer");
      return reply.send(fs.createReadStream(file.absolutePath));
    }
  );

  fastify.get("/api/projects/:envId/canvases/:canvasId/bridge.js", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = canvasParams.parse(request.params);
    await loadCanvasForRequest({
      envId: params.envId,
      canvasId: params.canvasId,
      userId: request.user.id
    });
    reply.header("Content-Type", "application/javascript; charset=utf-8");
    return reply.send(buildBridgeScript(params.canvasId));
  });

  fastify.get("/api/projects/:envId/canvases/:canvasId/raw", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = canvasParams.parse(request.params);
    const { canvas } = await loadCanvasForRequest({
      envId: params.envId,
      canvasId: params.canvasId,
      userId: request.user.id
    });
    const freshCanvas = await getProjectCanvas(canvas.id);
    if (!freshCanvas) {
      return reply.status(404).send({ error: "Canvas not found" });
    }
    return { canvas: freshCanvas };
  });
}
