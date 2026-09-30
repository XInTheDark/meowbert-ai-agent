import { useEffect, useRef } from "react";
import { desktopComputerStreamUrl } from "../../lib/api";
import { type PlatformAdapter } from "../../desktop/platform";
import { appendStreamTicket, fetchDesktopComputerStreamTicket } from "../../lib/stream-tickets";
import type {
  DesktopComputerExecutorError,
  DesktopComputerExecutorRequest,
  DesktopComputerExecutorResult,
  DesktopComputerStatus
} from "@meowbert/shared";

interface DesktopComputerExecutorBridgeProps {
  token: string | null;
  enabled: boolean;
  platform: PlatformAdapter;
}

const DESKTOP_EXECUTOR_DEBUG_ENABLED = import.meta.env.DEV || (typeof window !== "undefined" && window.localStorage.getItem("meowbert_debug_computer_use") === "1");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDesktopComputerExecutorRequest(value: unknown): value is DesktopComputerExecutorRequest {
  return isRecord(value) && value.type === "computer_action" && typeof value.requestId === "string";
}

function isDesktopComputerExecutorError(value: unknown): value is DesktopComputerExecutorError {
  return isRecord(value) && value.type === "error" && typeof value.message === "string";
}

function logDesktopExecutorDebug(event: string, input: {
  requestId?: string;
  taskId?: string;
  toolName?: string;
  details?: Record<string, unknown>;
}): void {
  if (!DESKTOP_EXECUTOR_DEBUG_ENABLED) {
    return;
  }

  const route = typeof window === "undefined"
    ? null
    : window.location.hash || window.location.pathname || null;

  console.info("[desktop-executor-bridge]", {
    event,
    route,
    requestId: input.requestId ?? null,
    taskId: input.taskId ?? null,
    toolName: input.toolName ?? null,
    ...(input.details ? { details: input.details } : {})
  });
}

export function DesktopComputerExecutorBridge(props: DesktopComputerExecutorBridgeProps) {
  const reconnectDelayMsRef = useRef(1_000);

  useEffect(() => {
    if (!props.enabled || !props.token || !props.platform.capabilities.supportsComputerUse) {
      return;
    }
    const authToken = props.token;

    let disposed = false;
    let socket: WebSocket | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const sessionId = crypto.randomUUID();
    const recentResponses = new Map<string, DesktopComputerExecutorResult>();
    const recentResponseOrder: string[] = [];

    const rememberResponse = (response: DesktopComputerExecutorResult): void => {
      recentResponses.set(response.requestId, response);
      recentResponseOrder.push(response.requestId);
      while (recentResponseOrder.length > 100) {
        const oldest = recentResponseOrder.shift();
        if (!oldest) {
          break;
        }
        recentResponses.delete(oldest);
      }
    };

    const clearHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) {
        return;
      }

      const delay = reconnectDelayMsRef.current;
      reconnectDelayMsRef.current = Math.min(10_000, reconnectDelayMsRef.current * 2);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const sendStatus = async (targetSocket: WebSocket, messageType: "hello" | "heartbeat"): Promise<void> => {
      if (disposed || socket !== targetSocket || targetSocket.readyState !== WebSocket.OPEN) {
        return;
      }

      let status: DesktopComputerStatus;
      try {
        status = await props.platform.getComputerStatus();
      } catch (error) {
        console.error("Failed to read desktop computer status", error);
        return;
      }

      targetSocket.send(JSON.stringify({
        type: messageType,
        sessionId,
        status,
        sentAt: new Date().toISOString()
      }));
    };

    const handleRequest = async (targetSocket: WebSocket, request: DesktopComputerExecutorRequest): Promise<void> => {
      if (disposed || socket !== targetSocket || targetSocket.readyState !== WebSocket.OPEN) {
        return;
      }

      const cachedResponse = recentResponses.get(request.requestId);
      if (cachedResponse) {
        logDesktopExecutorDebug("return_cached_response", {
          requestId: request.requestId,
          taskId: request.taskId,
          toolName: request.toolName
        });
        targetSocket.send(JSON.stringify(cachedResponse));
        return;
      }

      try {
        logDesktopExecutorDebug("handle_request", {
          requestId: request.requestId,
          taskId: request.taskId,
          toolName: request.toolName
        });
        const result = await props.platform.performComputerAction({
          toolName: request.toolName,
          args: request.args,
          taskId: request.taskId,
          requestId: request.requestId
        });
        const response: DesktopComputerExecutorResult = {
          ...result,
          type: "computer_action_result",
          requestId: request.requestId,
          taskId: request.taskId,
          toolName: request.toolName,
          completedAt: result.completedAt || new Date().toISOString()
        };
        rememberResponse(response);
        logDesktopExecutorDebug("send_response", {
          requestId: request.requestId,
          taskId: request.taskId,
          toolName: request.toolName,
          details: {
            ok: response.ok
          }
        });
        if (socket === targetSocket && targetSocket.readyState === WebSocket.OPEN) {
          targetSocket.send(JSON.stringify(response));
        }
      } catch (error) {
        const response: DesktopComputerExecutorResult = {
          type: "computer_action_result",
          requestId: request.requestId,
          taskId: request.taskId,
          toolName: request.toolName,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          completedAt: new Date().toISOString()
        };
        rememberResponse(response);
        logDesktopExecutorDebug("send_error_response", {
          requestId: request.requestId,
          taskId: request.taskId,
          toolName: request.toolName,
          details: {
            error: response.error ?? null
          }
        });
        if (socket === targetSocket && targetSocket.readyState === WebSocket.OPEN) {
          targetSocket.send(JSON.stringify(response));
        }
      }
    };

    const connect = async (): Promise<void> => {
      if (disposed) {
        return;
      }

      clearHeartbeat();
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close();
      }

      let ticket: string;
      try {
        ticket = await fetchDesktopComputerStreamTicket(authToken);
      } catch (error) {
        if (!disposed) {
          console.error("Failed to authorize desktop computer stream", error);
          scheduleReconnect();
        }
        return;
      }

      const currentSocket = new WebSocket(appendStreamTicket(desktopComputerStreamUrl(), ticket));
      socket = currentSocket;

      currentSocket.addEventListener("open", () => {
        if (disposed || socket !== currentSocket) {
          currentSocket.close();
          return;
        }
        reconnectDelayMsRef.current = 1_000;
        logDesktopExecutorDebug("socket_open", {
          details: {
            sessionId
          }
        });
        void sendStatus(currentSocket, "hello");
        heartbeatTimer = setInterval(() => {
          void sendStatus(currentSocket, "heartbeat");
        }, 10_000);
      });

      currentSocket.addEventListener("message", (event) => {
        if (disposed || socket !== currentSocket) {
          return;
        }
        let payload: unknown;
        try {
          payload = JSON.parse(event.data as string);
        } catch {
          return;
        }

        if (isDesktopComputerExecutorRequest(payload)) {
          void handleRequest(currentSocket, payload);
          return;
        }

        if (isDesktopComputerExecutorError(payload)) {
          console.warn("Desktop computer executor error", payload.message);
        }
      });

      currentSocket.addEventListener("close", () => {
        if (socket !== currentSocket) {
          return;
        }
        logDesktopExecutorDebug("socket_close", {
          details: {
            sessionId
          }
        });
        socket = null;
        clearHeartbeat();
        if (!disposed) {
          scheduleReconnect();
        }
      });

      currentSocket.addEventListener("error", () => {
        if (socket !== currentSocket) {
          return;
        }
        logDesktopExecutorDebug("socket_error", {
          details: {
            sessionId
          }
        });
        clearHeartbeat();
      });
    };

    void connect();

    return () => {
      disposed = true;
      clearHeartbeat();
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close();
      }
      socket = null;
    };
  }, [props.enabled, props.platform, props.token]);

  return null;
}
