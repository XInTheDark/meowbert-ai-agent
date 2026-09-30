import { randomUUID } from "node:crypto";
import {
  DESKTOP_COMPUTER_REQUEST_CHANNEL,
  buildDesktopComputerPresenceKey,
  buildDesktopComputerResponseChannel,
  type ComputerToolName,
  type DesktopComputerExecutorResult,
  type DesktopComputerStatus
} from "@meowbert/shared";
import { redis } from "../../lib/redis.js";

interface DesktopComputerBrokerRequest {
  userId: string;
  requestId: string;
  taskId: string;
  toolName: ComputerToolName;
  args: Record<string, unknown>;
  issuedAt: string;
}

interface DesktopComputerPresencePayload {
  sessionId: string;
  connectedAt: string;
  lastSeenAt: string;
  status: DesktopComputerStatus;
}

const DESKTOP_COMPUTER_DEBUG_ENABLED = process.env.NODE_ENV !== "production" || process.env.MEOWBERT_DEBUG_COMPUTER_USE === "1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function getDesktopComputerPresence(userId: string | null | undefined): Promise<DesktopComputerPresencePayload | null> {
  const normalizedUserId = typeof userId === "string" ? userId.trim() : "";
  if (!normalizedUserId) {
    return null;
  }

  const raw = await redis.get(buildDesktopComputerPresenceKey(normalizedUserId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as {
      sessionId?: unknown;
      connectedAt?: unknown;
      lastSeenAt?: unknown;
      status?: unknown;
    };
    if (!isRecord(parsed.status)) {
      return null;
    }

    return {
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : "",
      connectedAt: typeof parsed.connectedAt === "string" ? parsed.connectedAt : new Date().toISOString(),
      lastSeenAt: typeof parsed.lastSeenAt === "string" ? parsed.lastSeenAt : new Date().toISOString(),
      status: parsed.status as unknown as DesktopComputerStatus
    };
  } catch {
    return null;
  }
}

export async function requestDesktopComputerAction(input: {
  userId: string;
  taskId: string;
  toolName: ComputerToolName;
  args: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<DesktopComputerExecutorResult> {
  const requestId = randomUUID();
  const responseChannel = buildDesktopComputerResponseChannel(requestId);
  const subscriber = redis.duplicate();
  const timeoutMs = typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
    ? Math.max(1_000, Math.floor(input.timeoutMs))
    : 60_000;

  if (DESKTOP_COMPUTER_DEBUG_ENABLED) {
    console.info("[worker-desktop-computer]", {
      event: "publish_request",
      userId: input.userId,
      requestId,
      taskId: input.taskId,
      toolName: input.toolName,
      timeoutMs
    });
  }

  try {
    await subscriber.subscribe(responseChannel);

    const resultPromise = new Promise<DesktopComputerExecutorResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for the desktop computer executor."));
      }, timeoutMs);

      subscriber.on("message", (_channel, message) => {
        try {
          const parsed = JSON.parse(message) as DesktopComputerExecutorResult;
          clearTimeout(timer);
          resolve(parsed);
        } catch (error) {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });

    const request: DesktopComputerBrokerRequest = {
      userId: input.userId,
      requestId,
      taskId: input.taskId,
      toolName: input.toolName,
      args: input.args,
      issuedAt: new Date().toISOString()
    };
    await redis.publish(DESKTOP_COMPUTER_REQUEST_CHANNEL, JSON.stringify(request));

    const result = await resultPromise;
    if (DESKTOP_COMPUTER_DEBUG_ENABLED) {
      console.info("[worker-desktop-computer]", {
        event: "receive_result",
        userId: input.userId,
        requestId,
        taskId: input.taskId,
        toolName: input.toolName,
        ok: result.ok
      });
    }

    return result;
  } finally {
    try {
      await subscriber.unsubscribe(responseChannel);
    } catch {
      // Ignore cleanup failures.
    }
    void subscriber.quit().catch(() => undefined);
  }
}
