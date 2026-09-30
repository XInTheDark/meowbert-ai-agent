import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getNewMessageOrganizationEnabled, loadConversationNavigation } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import { ensureTaskHistoryWarm } from "../../services/tasks/task-history.js";
import { resolveActiveLeafMessageId } from "../../services/tasks/task-service/index.js";
import { taskParams } from "./shared.js";

export async function registerTaskNavigationRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get("/api/tasks/:taskId/conversation/navigation", { preHandler: fastify.authenticate }, async (request, reply) => {
    const { taskId } = taskParams.parse(request.params);
    const input = z.object({ activeLeafMessageId: z.string().uuid().optional() }).parse(request.query);
    await assertTaskMember(taskId, request.user.id);
    const settings = await query<{ model_defaults_json: Record<string, unknown> }>(
      `SELECT ws.model_defaults_json FROM tasks t LEFT JOIN workspace_settings ws ON ws.workspace_id = t.workspace_id WHERE t.id = $1`, [taskId]);
    if (!getNewMessageOrganizationEnabled(settings.rows[0]?.model_defaults_json)) {
      return { enabled: false, active_leaf_message_id: null, outline: null, map: null, turns: [], messages: [] };
    }
    let leaf = input.activeLeafMessageId ?? null;
    if (leaf) {
      const target = await query("SELECT id FROM task_messages WHERE task_id = $1 AND id = $2", [taskId, leaf]);
      if (!target.rows.length) return reply.status(404).send({ error: "Conversation branch not found." });
    } else {
      leaf = await resolveActiveLeafMessageId({ taskId, userId: request.user.id });
    }
    await ensureTaskHistoryWarm(taskId);
    return loadConversationNavigation({ query }, taskId, leaf);
  });
}
