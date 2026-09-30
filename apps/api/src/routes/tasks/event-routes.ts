import type { ServerResponse } from "node:http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { TASK_EVENT_CHANNEL_PREFIX } from "@meowbert/shared";
import { z } from "zod";
import { query } from "../../lib/db.js";
import { createRedisSubscriber } from "../../lib/redis.js";
import { getAdminSettings } from "../../services/admin/admin-settings.js";
import { issueScopedAccessTicket, verifyScopedAccessTicket } from "../../services/auth/scoped-access-tickets.js";
import { sanitizeTaskEventPayloadForDebugMode } from "../../services/tasks/task-debug-visibility.js";
import { ensureTaskHistoryWarm } from "../../services/tasks/task-history.js";
import { assertTaskMember } from "../../services/workspaces/workspace-access.js";
import { taskEventsPageQuery, taskEventsStreamQuery, taskParams } from "./shared.js";

interface TaskEventRow {
  id: string;
  type: string;
  payload_json: Record<string, unknown>;
  created_at: string;
}

const taskEventStreamTicketQuery = z.object({
  ticket: z.string().min(1)
});

function toTaskEventResponse(event: TaskEventRow, debugMode: boolean) {
  return {
    id: event.id,
    type: event.type,
    payload: sanitizeTaskEventPayloadForDebugMode(event.type, event.payload_json, debugMode),
    createdAt: event.created_at
  };
}

function writeEvent(stream: ServerResponse, eventName: string, data: unknown): void {
  if (stream.destroyed || stream.writableEnded) {
    return;
  }

  stream.write(`event: ${eventName}\n`);
  stream.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sanitizeStreamPayload(message: string, debugMode: boolean): string {
  try {
    const parsed = JSON.parse(message) as {
      type?: unknown;
      payload?: unknown;
    };
    if (typeof parsed?.type !== "string" || !parsed.payload || typeof parsed.payload !== "object") {
      return message;
    }

    return JSON.stringify({
      ...parsed,
      payload: sanitizeTaskEventPayloadForDebugMode(parsed.type, parsed.payload as Record<string, unknown>, debugMode)
    });
  } catch {
    return message;
  }
}

async function handleGetTaskEvents(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  const queryInput = taskEventsPageQuery.parse(request.query ?? {});
  await assertTaskMember(params.taskId, request.user.id);
  await ensureTaskHistoryWarm(params.taskId);
  const debugMode = (await getAdminSettings()).debugMode;

  const hasCursor = Boolean(queryInput.cursorCreatedAt) || Boolean(queryInput.cursorId);
  if ((queryInput.cursorCreatedAt && !queryInput.cursorId) || (!queryInput.cursorCreatedAt && queryInput.cursorId)) {
    return reply.status(400).send({ error: "cursorCreatedAt and cursorId must be provided together." });
  }

  const limitPlusOne = queryInput.limit + 1;
  if (queryInput.direction === "newer" && !hasCursor) {
    return { direction: "newer", hasMore: false, items: [] };
  }
  if (queryInput.direction === "older") {
    const olderRows = hasCursor
      ? await query<TaskEventRow>(
          `SELECT id, type, payload_json, created_at
             FROM task_events
            WHERE task_id = $1
              AND (created_at, id) < ($2::timestamptz, $3::uuid)
            ORDER BY created_at DESC, id DESC
            LIMIT $4`,
          [params.taskId, queryInput.cursorCreatedAt, queryInput.cursorId, limitPlusOne]
        )
      : await query<TaskEventRow>(
          `SELECT id, type, payload_json, created_at
             FROM task_events
            WHERE task_id = $1
            ORDER BY created_at DESC, id DESC
            LIMIT $2`,
          [params.taskId, limitPlusOne]
        );

    const hasMore = olderRows.rows.length > queryInput.limit;
    const pageItems = olderRows.rows.slice(0, queryInput.limit).reverse();
    return { direction: "older", hasMore, items: pageItems.map((event) => toTaskEventResponse(event, debugMode)) };
  }

  const newerRows = await query<TaskEventRow>(
    `SELECT id, type, payload_json, created_at
       FROM task_events
      WHERE task_id = $1
        AND (created_at, id) > ($2::timestamptz, $3::uuid)
      ORDER BY created_at ASC, id ASC
      LIMIT $4`,
    [params.taskId, queryInput.cursorCreatedAt, queryInput.cursorId, limitPlusOne]
  );

  const hasMore = newerRows.rows.length > queryInput.limit;
  const pageItems = newerRows.rows.slice(0, queryInput.limit);
  return { direction: "newer", hasMore, items: pageItems.map((event) => toTaskEventResponse(event, debugMode)) };
}

async function replayRecentEvents(taskId: string, replayLimit: number, debugMode: boolean, stream: ServerResponse): Promise<void> {
  if (replayLimit <= 0) {
    return;
  }

  const replayEvents = await query<TaskEventRow>(
    `SELECT id, type, payload_json, created_at
       FROM task_events
      WHERE task_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [taskId, replayLimit]
  );

  for (const event of [...replayEvents.rows].reverse()) {
    writeEvent(stream, event.type, toTaskEventResponse(event, debugMode));
  }
}

async function handleStreamTaskEvents(request: FastifyRequest, reply: FastifyReply) {
  const params = taskParams.parse(request.params);
  const queryInput = taskEventsStreamQuery.parse(request.query ?? {});
  await assertTaskMember(params.taskId, request.user.id);
  await ensureTaskHistoryWarm(params.taskId);
  const debugMode = (await getAdminSettings()).debugMode;

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
  const channel = `${TASK_EVENT_CHANNEL_PREFIX}${params.taskId}`;
  const messageHandler = (incomingChannel: string, message: string): void => {
    if (incomingChannel !== channel || stream.destroyed || stream.writableEnded) {
      return;
    }

    stream.write("event: update\n");
    stream.write(`data: ${sanitizeStreamPayload(message, debugMode)}\n\n`);
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
    writeEvent(stream, "ready", { taskId: params.taskId });
    await replayRecentEvents(params.taskId, queryInput.replayLimit, debugMode, stream);
    await subscriber.subscribe(channel);
    subscriber.on("message", messageHandler);
  } catch (error) {
    request.log.error({ err: error, taskId: params.taskId }, "Failed to initialize task event stream");
    writeEvent(stream, "error", { message: "Failed to initialize task event stream." });
    teardown();
  }
}

export async function registerTaskEventRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/api/tasks/:taskId/events/stream-ticket", { preHandler: fastify.authenticate }, async (request) => {
    const params = taskParams.parse(request.params);
    await assertTaskMember(params.taskId, request.user.id);

    return issueScopedAccessTicket(fastify, {
      scope: "task_events_stream",
      userId: request.user.id,
      taskId: params.taskId
    });
  });

  const authenticateTaskEventStream = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = taskParams.parse(request.params);
    const queryInput = taskEventStreamTicketQuery.parse(request.query ?? {});

    try {
      const payload = await verifyScopedAccessTicket(fastify, {
        ticket: queryInput.ticket,
        scope: "task_events_stream",
        taskId: params.taskId
      });
      request.user = {
        id: payload.userId,
        email: ""
      };
    } catch {
      return reply.status(401).send({ error: "Unauthorized" });
    }
  };

  fastify.get("/api/tasks/:taskId/events", { preHandler: fastify.authenticate }, handleGetTaskEvents);
  fastify.get("/api/tasks/:taskId/events/stream", { preHandler: authenticateTaskEventStream }, handleStreamTaskEvents);
}
