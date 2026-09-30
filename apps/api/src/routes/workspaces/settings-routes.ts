import type { ServerResponse } from "node:http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { WORKSPACE_NOTIFICATION_CHANNEL_PREFIX, type TaskEventPayload } from "@meowbert/shared";
import { z } from "zod";
import { query } from "../../lib/db.js";
import { createRedisSubscriber } from "../../lib/redis.js";
import { issueScopedAccessTicket, verifyScopedAccessTicket } from "../../services/auth/scoped-access-tickets.js";
import { assertWorkspaceMember } from "../../services/workspaces/workspace-access.js";
import { personalityDefaultId, personalityOptions } from "../environments/shared.js";
import {
  isWorkspaceOwner,
  workspaceNotificationsQuerySchema,
  workspaceParamsSchema
} from "./shared.js";

const WORKSPACE_NOTIFICATION_RETENTION_DAYS = 14;

const workspaceNotificationStreamTicketQuery = z.object({
  ticket: z.string().min(1)
});

interface WorkspaceNotificationRow {
  id: string;
  task_id: string;
  task_title: string | null;
  task_status: string;
  environment_id: string;
  environment_name: string;
  task_type: "standard" | "scheduled" | "infinite" | "timed" | "long_horizon" | "agent_swarm";
  payload_json: Record<string, unknown>;
  created_at: string;
}

function writeWorkspaceNotificationStreamEvent(stream: ServerResponse, eventName: string, data: unknown): void {
  if (stream.destroyed || stream.writableEnded) {
    return;
  }

  stream.write(`event: ${eventName}\n`);
  stream.write(`data: ${JSON.stringify(data)}\n\n`);
}

function mapWorkspaceNotificationRow(row: WorkspaceNotificationRow) {
  const payload = row.payload_json ?? {};
  const channel = typeof payload.channel === "string" ? payload.channel : "unknown";
  const status = typeof payload.status === "string" ? payload.status : "unknown";
  const runId = typeof payload.runId === "string" ? payload.runId : null;
  const preview = typeof payload.preview === "string" ? payload.preview : null;
  const detail = typeof payload.detail === "string" ? payload.detail : null;
  const externalMessageId =
    typeof payload.externalMessageId === "string" ? payload.externalMessageId : null;

  return {
    id: row.id,
    task_id: row.task_id,
    task_title: row.task_title,
    task_status: row.task_status,
    environment_id: row.environment_id,
    environment_name: row.environment_name,
    task_type: row.task_type,
    channel,
    status,
    run_id: runId,
    preview,
    detail,
    external_message_id: externalMessageId,
    created_at: row.created_at
  };
}

function parsePotentialWorkspaceNotification(message: string): TaskEventPayload | null {
  try {
    const event = JSON.parse(message) as Partial<TaskEventPayload>;
    if (
      typeof event.id !== "string"
      || typeof event.taskId !== "string"
      || event.type !== "notification"
      || !event.payload
      || typeof event.payload !== "object"
      || typeof event.createdAt !== "string"
    ) {
      return null;
    }

    const payload = event.payload as Record<string, unknown>;
    if (payload.channel !== "web" || payload.status !== "sent") {
      return null;
    }

    return event as TaskEventPayload;
  } catch {
    return null;
  }
}

async function loadWorkspaceNotificationEvent(
  workspaceId: string,
  event: TaskEventPayload
): Promise<ReturnType<typeof mapWorkspaceNotificationRow> | null> {
  const result = await query<WorkspaceNotificationRow>(
    `SELECT
        te.id,
        te.task_id,
        t.title AS task_title,
        t.status AS task_status,
        t.environment_id,
        e.name AS environment_name,
        CASE
          WHEN t.workflow_type IS NOT NULL THEN t.workflow_type
          WHEN ts.task_id IS NULL THEN 'standard'
          WHEN ts.mode = 'infinite' AND ts.run_timeout_seconds IS NOT NULL THEN 'timed'
          ELSE ts.mode
        END AS task_type,
        te.payload_json,
        te.created_at
       FROM task_events te
       JOIN tasks t
         ON t.id = te.task_id
       JOIN environments e
         ON e.id = t.environment_id
       LEFT JOIN task_schedules ts
         ON ts.task_id = t.id
      WHERE t.workspace_id = $1
        AND te.id = $2
        AND te.task_id = $3
        AND te.type = 'notification'
        AND te.created_at >= now() - ($4::int * interval '1 day')
        AND t.trashed_at IS NULL
        AND t.workflow_parent_task_id IS NULL
      LIMIT 1`,
    [workspaceId, event.id, event.taskId, WORKSPACE_NOTIFICATION_RETENTION_DAYS]
  );
  const row = result.rows[0];
  return row ? mapWorkspaceNotificationRow(row) : null;
}

export async function registerWorkspaceSettingsAuxRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/api/workspaces/:wsId/notifications/stream-ticket", { preHandler: fastify.authenticate }, async (request) => {
    const params = workspaceParamsSchema.parse(request.params);
    await assertWorkspaceMember(params.wsId, request.user.id);

    return issueScopedAccessTicket(fastify, {
      scope: "workspace_notifications_stream",
      userId: request.user.id,
      workspaceId: params.wsId
    });
  });

  const authenticateWorkspaceNotificationStream = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = workspaceParamsSchema.parse(request.params);
    const queryInput = workspaceNotificationStreamTicketQuery.parse(request.query ?? {});

    try {
      const payload = await verifyScopedAccessTicket(fastify, {
        ticket: queryInput.ticket,
        scope: "workspace_notifications_stream",
        workspaceId: params.wsId
      });
      request.user = {
        id: payload.userId,
        email: ""
      };
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  };

  fastify.get("/api/workspaces/:wsId/notifications/stream", { preHandler: authenticateWorkspaceNotificationStream }, async (request, reply) => {
    const params = workspaceParamsSchema.parse(request.params);
    await assertWorkspaceMember(params.wsId, request.user.id);

    reply.hijack();
    const stream = reply.raw;
    stream.setHeader("Content-Type", "text/event-stream");
    stream.setHeader("Cache-Control", "no-cache");
    stream.setHeader("Connection", "keep-alive");

    const origin = request.headers.origin;
    if (origin) {
      stream.setHeader("Access-Control-Allow-Origin", origin);
      stream.setHeader("Access-Control-Allow-Credentials", "true");
    }
    stream.flushHeaders();

    const subscriber = createRedisSubscriber();
    const channel = `${WORKSPACE_NOTIFICATION_CHANNEL_PREFIX}${params.wsId}`;
    const messageHandler = (incomingChannel: string, message: string): void => {
      if (incomingChannel !== channel) {
        return;
      }

      const event = parsePotentialWorkspaceNotification(message);
      if (!event || stream.destroyed || stream.writableEnded) {
        return;
      }

      void loadWorkspaceNotificationEvent(params.wsId, event)
        .then((notification) => {
          if (notification) {
            writeWorkspaceNotificationStreamEvent(stream, "notification", notification);
          }
        })
        .catch((error) => {
          request.log.warn({ err: error, workspaceId: params.wsId }, "Failed to forward workspace notification event");
        });
    };

    const teardown = (): void => {
      subscriber.off("message", messageHandler);
      void subscriber.unsubscribe(channel).catch(() => undefined);
      void subscriber.quit().catch(() => undefined);
      if (!stream.writableEnded) {
        stream.end();
      }
    };

    request.raw.on("close", teardown);

    try {
      writeWorkspaceNotificationStreamEvent(stream, "ready", { workspaceId: params.wsId });
      await subscriber.subscribe(channel);
      subscriber.on("message", messageHandler);
    } catch (error) {
      request.log.error({ err: error, workspaceId: params.wsId }, "Failed to initialize workspace notification stream");
      writeWorkspaceNotificationStreamEvent(stream, "error", { message: "Failed to initialize workspace notification stream." });
      teardown();
    }
  });

  fastify.get("/api/workspaces/:wsId/personalities", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = workspaceParamsSchema.parse(request.params);
    await assertWorkspaceMember(params.wsId, request.user.id);

    reply.header("Cache-Control", "private, max-age=300");
    return {
      items: personalityOptions,
      defaultId: personalityDefaultId
    };
  });

  fastify.get("/api/workspaces/:wsId/routing-rules", { preHandler: fastify.authenticate }, async (request) => {
    const params = workspaceParamsSchema.parse(request.params);
    await assertWorkspaceMember(params.wsId, request.user.id);

    const result = await query<{
      id: string;
      priority: number;
      rule_type: string;
      rule_json: Record<string, unknown>;
      enabled: boolean;
    }>(
      `SELECT id, priority, rule_type, rule_json, enabled
         FROM routing_rules
        WHERE workspace_id = $1
        ORDER BY priority ASC`,
      [params.wsId]
    );

    return { items: result.rows };
  });

  fastify.put("/api/workspaces/:wsId/routing-rules", { preHandler: fastify.authenticate }, async (request, reply) => {
    const params = workspaceParamsSchema.parse(request.params);
    await assertWorkspaceMember(params.wsId, request.user.id);

    if (!(await isWorkspaceOwner(params.wsId, request.user.id))) {
      return reply.status(403).send({ error: "Only owners can update workspace settings" });
    }

    const body = z
      .object({
        rules: z.array(
          z.object({
            id: z.string().uuid().optional(),
            priority: z.number().int(),
            ruleType: z.enum(["default_env", "prefix_env", "keyword_map", "llm_fallback"]),
            ruleJson: z.record(z.unknown()),
            enabled: z.boolean()
          })
        )
      })
      .parse(request.body);

    await query(`DELETE FROM routing_rules WHERE workspace_id = $1`, [params.wsId]);

    for (const rule of body.rules) {
      await query(
        `INSERT INTO routing_rules (id, workspace_id, priority, rule_type, rule_json, enabled)
         VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5::jsonb, $6)`,
        [rule.id ?? null, params.wsId, rule.priority, rule.ruleType, JSON.stringify(rule.ruleJson), rule.enabled]
      );
    }

    return { ok: true };
  });

  fastify.get("/api/workspaces/:wsId/notifications", { preHandler: fastify.authenticate }, async (request) => {
    const params = workspaceParamsSchema.parse(request.params);
    const queryParams = workspaceNotificationsQuerySchema.parse(request.query);
    await assertWorkspaceMember(params.wsId, request.user.id);

    const result = await query<{
      id: string;
      task_id: string;
      task_title: string | null;
      task_status: string;
      environment_id: string;
      environment_name: string;
      task_type: "standard" | "scheduled" | "infinite" | "timed" | "long_horizon" | "agent_swarm";
      payload_json: Record<string, unknown>;
      created_at: string;
    }>(
      `SELECT
          te.id,
          te.task_id,
          t.title AS task_title,
          t.status AS task_status,
          t.environment_id,
          e.name AS environment_name,
          CASE
            WHEN t.workflow_type IS NOT NULL THEN t.workflow_type
            WHEN ts.task_id IS NULL THEN 'standard'
            WHEN ts.mode = 'infinite' AND ts.run_timeout_seconds IS NOT NULL THEN 'timed'
            ELSE ts.mode
          END AS task_type,
          te.payload_json,
          te.created_at
         FROM task_events te
         JOIN tasks t
           ON t.id = te.task_id
         JOIN environments e
           ON e.id = t.environment_id
         LEFT JOIN task_schedules ts
           ON ts.task_id = t.id
        WHERE t.workspace_id = $1
          AND te.type = 'notification'
          AND te.created_at >= now() - ($3::int * interval '1 day')
          AND t.trashed_at IS NULL
          AND t.workflow_parent_task_id IS NULL
        ORDER BY te.created_at DESC, te.id DESC
        LIMIT $2`,
      [params.wsId, queryParams.limit, WORKSPACE_NOTIFICATION_RETENTION_DAYS]
    );

    return {
      items: result.rows.map((row) => {
        const payload = row.payload_json ?? {};
        const channel = typeof payload.channel === "string" ? payload.channel : "unknown";
        const status = typeof payload.status === "string" ? payload.status : "unknown";
        const runId = typeof payload.runId === "string" ? payload.runId : null;
        const preview = typeof payload.preview === "string" ? payload.preview : null;
        const detail = typeof payload.detail === "string" ? payload.detail : null;
        const externalMessageId =
          typeof payload.externalMessageId === "string" ? payload.externalMessageId : null;

        return {
          id: row.id,
          task_id: row.task_id,
          task_title: row.task_title,
          task_status: row.task_status,
          environment_id: row.environment_id,
          environment_name: row.environment_name,
          task_type: row.task_type,
          channel,
          status,
          run_id: runId,
          preview,
          detail,
          external_message_id: externalMessageId,
          created_at: row.created_at
        };
      })
    };
  });
}
