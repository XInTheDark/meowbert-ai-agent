import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createTaskHistorySearchQuerySchema } from "@meowbert/shared/task-history-search";
import { searchGlobalTasks } from "../services/task-search/query.js";

const globalTaskSearchQuery = createTaskHistorySearchQuerySchema({
  defaultPageSize: 25,
  defaultScope: "active",
  defaultSortBy: "relevance",
  defaultSortDir: "desc"
}).and(z.object({
  workspaceId: z
    .union([z.string().uuid(), z.array(z.string().uuid())])
    .optional()
    .transform((value) => value === undefined ? null : Array.isArray(value) ? value : [value])
}));

export async function searchRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/search/tasks", { preHandler: fastify.authenticate }, async (request) => {
    const queryInput = globalTaskSearchQuery.parse(request.query ?? {});
    const { workspaceId, ...filters } = queryInput;

    return searchGlobalTasks({
      actorUserId: request.user.id,
      workspaceIds: workspaceId,
      filters
    });
  });
}
