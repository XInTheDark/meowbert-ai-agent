import WebSocket from "ws";
import type { FastifyBaseLogger } from "fastify";
import {
  DESKTOP_COMPUTER_PRESENCE_TTL_SECONDS,
  DESKTOP_COMPUTER_REQUEST_CHANNEL,
  buildDesktopComputerPresenceKey,
  buildDesktopComputerResponseChannel,
  type DesktopComputerExecutorClientMessage,
  type DesktopComputerExecutorRequest,
  type DesktopComputerExecutorResult,
  type DesktopComputerStatus
} from "@meowbert/shared";
import { createRedisSubscriber, redis } from "../../lib/redis.js";

interface DesktopComputerBrokerRequest extends Omit<DesktopComputerExecutorRequest, "type"> {
  userId: string;
}

interface DesktopComputerPresencePayload {
  sessionId: string;
  connectedAt: string;
  lastSeenAt: string;
  status: DesktopComputerStatus;
}

interface DesktopComputerConnection {
  userId: string;
  socket: WebSocket;
  connectedAt: string;
  sessionId: string | null;
  lastStatus: DesktopComputerStatus | null;
}

const connectionsByUserId = new Map<string, DesktopComputerConnection>();
let brokerStarted = false;
let brokerLogger: FastifyBaseLogger | null = null;
const DESKTOP_COMPUTER_DEBUG_ENABLED = process.env.NODE_ENV !== "production" || process.env.MEOWBERT_DEBUG_COMPUTER_USE === "1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendJson(socket: WebSocket, payload: Record<string, unknown>): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

async function publishDesktopComputerError(request: DesktopComputerBrokerRequest, message: string): Promise<void> {
  const result: DesktopComputerExecutorResult = {
    type: "computer_action_result",
    requestId: request.requestId,
    taskId: request.taskId,
    toolName: request.toolName,
    ok: false,
    error: message,
    completedAt: new Date().toISOString()
  };
  await redis.publish(buildDesktopComputerResponseChannel(request.requestId), JSON.stringify(result));
}

async function updatePresence(connection: DesktopComputerConnection, status: DesktopComputerStatus, sessionId: string): Promise<void> {
  connection.sessionId = sessionId;
  connection.lastStatus = status;
  const now = new Date().toISOString();
  const payload: DesktopComputerPresencePayload = {
    sessionId,
    connectedAt: connection.connectedAt,
    lastSeenAt: now,
    status
  };
  await redis.set(
    buildDesktopComputerPresenceKey(connection.userId),
    JSON.stringify(payload),
    "EX",
    DESKTOP_COMPUTER_PRESENCE_TTL_SECONDS
  );
}

async function clearPresence(userId: string, expectedSessionId: string | null): Promise<void> {
  if (!expectedSessionId) {
    await redis.del(buildDesktopComputerPresenceKey(userId));
    return;
  }

  const current = await redis.get(buildDesktopComputerPresenceKey(userId));
  if (!current) {
    return;
  }

  try {
    const parsed = JSON.parse(current) as { sessionId?: unknown };
    if (parsed.sessionId === expectedSessionId) {
      await redis.del(buildDesktopComputerPresenceKey(userId));
    }
  } catch {
    await redis.del(buildDesktopComputerPresenceKey(userId));
  }
}

function isDesktopComputerClientMessage(value: unknown): value is DesktopComputerExecutorClientMessage {
  return isRecord(value) && typeof value.type === "string";
}

async function handleDesktopComputerRequest(rawMessage: string): Promise<void> {
  let request: DesktopComputerBrokerRequest;
  try {
    request = JSON.parse(rawMessage) as DesktopComputerBrokerRequest;
  } catch {
    brokerLogger?.warn("Ignoring malformed desktop computer request payload.");
    return;
  }

  if (!request || typeof request.userId !== "string" || typeof request.requestId !== "string") {
    brokerLogger?.warn("Ignoring incomplete desktop computer request payload.");
    return;
  }

  const connection = connectionsByUserId.get(request.userId);
  if (!connection || connection.socket.readyState !== WebSocket.OPEN) {
    await publishDesktopComputerError(request, "No connected Meowbert Desktop executor is available for this user.");
    return;
  }

  const outgoing: DesktopComputerExecutorRequest = {
    type: "computer_action",
    requestId: request.requestId,
    taskId: request.taskId,
    toolName: request.toolName,
    args: request.args,
    issuedAt: request.issuedAt
  };
  if (DESKTOP_COMPUTER_DEBUG_ENABLED) {
    brokerLogger?.info({
      userId: request.userId,
      requestId: request.requestId,
      taskId: request.taskId,
      toolName: request.toolName,
      sessionId: connection.sessionId
    }, "Forwarding desktop computer request");
  }
  sendJson(connection.socket, outgoing as unknown as Record<string, unknown>);
}

export async function ensureDesktopComputerBrokerStarted(logger: FastifyBaseLogger): Promise<void> {
  brokerLogger = logger;
  if (brokerStarted) {
    return;
  }
  brokerStarted = true;

  const subscriber = createRedisSubscriber();
  subscriber.on("message", (_channel, message) => {
    void handleDesktopComputerRequest(message).catch((error) => {
      brokerLogger?.error({ err: error }, "Desktop computer broker request handling failed");
    });
  });

  await subscriber.subscribe(DESKTOP_COMPUTER_REQUEST_CHANNEL);
}

export function registerDesktopComputerConnection(input: {
  userId: string;
  socket: WebSocket;
  logger: FastifyBaseLogger;
}): void {
  const existing = connectionsByUserId.get(input.userId);
  if (existing && existing.socket !== input.socket && existing.socket.readyState === WebSocket.OPEN) {
    if (DESKTOP_COMPUTER_DEBUG_ENABLED) {
      input.logger.info({
        userId: input.userId,
        replacedSessionId: existing.sessionId
      }, "Replacing existing desktop computer connection");
    }
    existing.socket.close(4000, "Another desktop computer executor connected");
  }

  const connection: DesktopComputerConnection = {
    userId: input.userId,
    socket: input.socket,
    connectedAt: new Date().toISOString(),
    sessionId: null,
    lastStatus: null
  };
  connectionsByUserId.set(input.userId, connection);
  if (DESKTOP_COMPUTER_DEBUG_ENABLED) {
    input.logger.info({ userId: input.userId }, "Registered desktop computer connection");
  }

  input.socket.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      sendJson(input.socket, { type: "error", message: "Invalid desktop computer message payload." });
      return;
    }

    if (!isDesktopComputerClientMessage(parsed)) {
      sendJson(input.socket, { type: "error", message: "Unsupported desktop computer message." });
      return;
    }

    if (parsed.type === "hello" || parsed.type === "heartbeat") {
      void updatePresence(connection, parsed.status, parsed.sessionId).catch((error) => {
        input.logger.error({ err: error, userId: input.userId }, "Failed to update desktop computer presence");
      });
      sendJson(input.socket, { type: "ack", receivedAt: new Date().toISOString() });
      return;
    }

    if (parsed.type === "computer_action_result") {
      const result: DesktopComputerExecutorResult = {
        ...parsed,
        completedAt: parsed.completedAt || new Date().toISOString()
      };
      if (DESKTOP_COMPUTER_DEBUG_ENABLED) {
        input.logger.info({
          userId: input.userId,
          requestId: result.requestId,
          taskId: result.taskId,
          toolName: result.toolName,
          ok: result.ok
        }, "Publishing desktop computer result");
      }
      void redis.publish(buildDesktopComputerResponseChannel(result.requestId), JSON.stringify(result)).catch((error) => {
        input.logger.error({ err: error, userId: input.userId }, "Failed to publish desktop computer result");
      });
      return;
    }

    sendJson(input.socket, { type: "error", message: "Unknown desktop computer message." });
  });

  const cleanup = () => {
    const current = connectionsByUserId.get(input.userId);
    if (current?.socket === input.socket) {
      if (DESKTOP_COMPUTER_DEBUG_ENABLED) {
        input.logger.info({
          userId: input.userId,
          sessionId: current.sessionId
        }, "Cleaning up desktop computer connection");
      }
      connectionsByUserId.delete(input.userId);
      void clearPresence(input.userId, current.sessionId).catch((error) => {
        input.logger.error({ err: error, userId: input.userId }, "Failed to clear desktop computer presence");
      });
    }
  };

  input.socket.on("close", cleanup);
  input.socket.on("error", cleanup);
}
