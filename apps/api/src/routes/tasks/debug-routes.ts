import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { query } from "../../lib/db.js";
import { getAdminSettings } from "../../services/admin/admin-settings.js";
import { ensureTaskHistoryWarm } from "../../services/tasks/task-history.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import { taskParams } from "./shared.js";

interface DebugTaskMessageRow {
  id: string;
  role: string;
  content_json: Record<string, unknown>;
  message_metadata_json: Record<string, unknown> | null;
  parent_message_id: string | null;
  edited_from_message_id: string | null;
  created_at: string;
}

function selectResponseItems(content: Record<string, unknown>): unknown[] {
  return Array.isArray(content.response_items) ? content.response_items : [];
}

async function handleGetTaskDebugMessageItems(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  const [, adminSettings] = await Promise.all([
    assertTaskMember(params.taskId, request.user.id),
    getAdminSettings()
  ]);

  if (!adminSettings.debugMode) {
    return reply.status(404).send({ error: "Not found" });
  }

  await ensureTaskHistoryWarm(params.taskId);

  const messagesRes = await query<DebugTaskMessageRow>(
    `SELECT id,
            role,
            content_json,
            message_metadata_json,
            parent_message_id,
            edited_from_message_id,
            created_at
       FROM task_messages
      WHERE task_id = $1
      ORDER BY created_at ASC, id ASC`,
    [params.taskId]
  );

  return {
    taskId: params.taskId,
    items: messagesRes.rows.map((message) => ({
      id: message.id,
      role: message.role,
      created_at: message.created_at,
      parent_message_id: message.parent_message_id,
      edited_from_message_id: message.edited_from_message_id,
      message_metadata_json: message.message_metadata_json,
      response_items: selectResponseItems(message.content_json),
      content_json: message.content_json
    }))
  };
}

export async function registerTaskDebugRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    "/api/tasks/:taskId/debug/message-items",
    { preHandler: fastify.authenticate },
    handleGetTaskDebugMessageItems
  );
}
