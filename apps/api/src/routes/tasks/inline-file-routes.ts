import fs from "node:fs";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { issueScopedAccessTicket, verifyScopedAccessTicket } from "../../services/auth/scoped-access-tickets.js";
import { getFileContentType } from "../../services/files/file-content-type.js";
import { resolvePublicTaskInlineFile, resolveTaskInlineFile } from "../../services/tasks/task-inline-files.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import { applyUntrustedContentHeaders } from "../files/untrusted-content-headers.js";

const taskIdParams = z.object({ taskId: z.string().uuid() });
const publicTaskShareParams = z.object({ shareId: z.string().uuid() });

const taskInlineFileParams = z.object({
  taskId: z.string().uuid(),
  "*": z.string().trim().min(1)
});

const publicTaskInlineFileParams = publicTaskShareParams.extend({
  "*": z.string().trim().min(1)
});

function parseTaskInlineFileRequestParams(params: unknown): {
  taskId: string;
  ticket: string;
  requestedPath: string;
} {
  const parsed = taskInlineFileParams.parse(params);
  const segments = parsed["*"]
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length < 2) {
    throw new Error("Inline file request must include a ticket and file path.");
  }

  const [ticket, ...requestedPathSegments] = segments;
  return {
    taskId: parsed.taskId,
    ticket,
    requestedPath: requestedPathSegments.join("/")
  };
}

async function authenticateTaskInlineFileRequest(request: FastifyRequest, reply: {
  status: (code: number) => { send: (payload: unknown) => unknown };
}) {
  let params;
  try {
    params = parseTaskInlineFileRequestParams(request.params);
  } catch {
    return reply.status(404).send({ error: "Not Found" });
  }

  try {
    const payload = await verifyScopedAccessTicket(request.server, {
      ticket: params.ticket,
      scope: "task_inline_file_view",
      taskId: params.taskId
    });
    request.user = {
      id: payload.userId,
      email: ""
    };
  } catch {
    return reply.status(401).send({ error: "Unauthorized" });
  }
}

export async function registerTaskInlineFileRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/api/tasks/:taskId/inline-files/ticket", { preHandler: fastify.authenticate }, async (request) => {
    const params = taskIdParams.parse(request.params);
    await assertTaskMember(params.taskId, request.user.id);

    return issueScopedAccessTicket(fastify, {
      scope: "task_inline_file_view",
      userId: request.user.id,
      taskId: params.taskId
    });
  });

  fastify.get(
    // Keep the access ticket inside the wildcard so long signed ticket values still match the route.
    "/api/tasks/:taskId/inline-files/*",
    { preHandler: authenticateTaskInlineFileRequest },
    async (request, reply) => {
      const params = parseTaskInlineFileRequestParams(request.params);
      const file = await resolveTaskInlineFile(params.taskId, params.requestedPath);

      reply.header("Content-Type", getFileContentType(file.absolutePath));
      reply.header("Content-Length", String(file.sizeBytes));
      reply.header("Cache-Control", "private, max-age=60");
      applyUntrustedContentHeaders(reply);
      return reply.send(fs.createReadStream(file.absolutePath));
    }
  );

  fastify.get(
    "/api/public/tasks/:shareId/inline-files/*",
    async (request, reply) => {
      const params = publicTaskInlineFileParams.parse(request.params);
      const file = await resolvePublicTaskInlineFile(params.shareId, params["*"]);

      reply.header("Content-Type", getFileContentType(file.absolutePath));
      reply.header("Content-Length", String(file.sizeBytes));
      reply.header("Cache-Control", "public, max-age=60");
      applyUntrustedContentHeaders(reply);
      return reply.send(fs.createReadStream(file.absolutePath));
    }
  );
}
