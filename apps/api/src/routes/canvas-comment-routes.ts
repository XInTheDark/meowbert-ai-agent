import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseCanvasFrameMessage } from "@meowbert/shared/canvas-frame";
import { query } from "../lib/db.js";
import { addCanvasComment, listCanvasComments, resolveCanvasComment, type CanvasCommentScope } from "../services/canvases/canvas-comments.js";
import { assertEnvironmentMember, assertTaskMember } from "../services/workspaces/workspace-access.js";

const scopeSchema = z.object({
  canvasId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  relativePath: z.string().trim().min(1).max(600)
}).strict().refine((scope) => Boolean(scope.canvasId) !== Boolean(scope.taskId), "Choose one canvas or task");

async function assertCommentAccess(scope: CanvasCommentScope, userId: string) {
  if (scope.taskId) return assertTaskMember(scope.taskId, userId);
  const result = await query<{ environment_id: string }>("SELECT environment_id FROM project_canvases WHERE id = $1", [scope.canvasId]);
  if (!result.rows[0]) throw new Error("Canvas not found");
  return assertEnvironmentMember(result.rows[0].environment_id, userId);
}

export async function registerCanvasCommentRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/canvas-comments", { preHandler: app.authenticate }, async (request) => {
    const scope = scopeSchema.parse(request.query);
    await assertCommentAccess(scope, request.user.id);
    return { items: await listCanvasComments(scope) };
  });
  app.post("/api/canvas-comments", { preHandler: app.authenticate }, async (request, reply) => {
    const body = z.object({ scope: scopeSchema, element: z.unknown(), body: z.string().trim().min(1).max(4000) }).strict().parse(request.body);
    await assertCommentAccess(body.scope, request.user.id);
    const selection = parseCanvasFrameMessage({ source: "meowbert-canvas", type: "selection", element: body.element });
    if (selection?.type !== "selection" || !selection.element) return reply.status(400).send({ error: "Select an element first" });
    return reply.status(201).send({ comment: await addCanvasComment(body.scope, request.user.id, selection.element, body.body) });
  });
  app.patch("/api/canvas-comments/:commentId", { preHandler: app.authenticate }, async (request, reply) => {
    const { commentId } = z.object({ commentId: z.string().uuid() }).parse(request.params);
    const body = z.object({ scope: scopeSchema, resolved: z.boolean() }).strict().parse(request.body);
    await assertCommentAccess(body.scope, request.user.id);
    const comment = await resolveCanvasComment(body.scope, commentId, body.resolved);
    return comment ? { comment } : reply.status(404).send({ error: "Comment not found" });
  });
}
