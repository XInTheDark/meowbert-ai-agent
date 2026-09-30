import { isTaskDebugModeEnabled } from "../runtime/debug-task-events.js";
import { formatNetworkRequestLogMessage, type NetworkRequestLogEvent } from "./network-request-log.js";

export function sanitizeNetworkRequestEventForStorage(
  event: NetworkRequestLogEvent,
  debugModeEnabled: boolean
): NetworkRequestLogEvent {
  if (debugModeEnabled) {
    return event;
  }

  if (event.phase !== "debug" && !event.request && !event.responseStream) {
    if (event.phase !== "error" || !event.errorResponse) {
      return event;
    }
  }

  const sanitizedEvent = { ...event };
  if (sanitizedEvent.phase === "debug") {
    delete sanitizedEvent.details;
  }
  if (sanitizedEvent.phase === "error") {
    delete sanitizedEvent.errorResponse;
  }
  if (sanitizedEvent.phase === "success" || sanitizedEvent.phase === "error") {
    delete sanitizedEvent.responseStream;
  }
  if ("request" in sanitizedEvent) {
    delete sanitizedEvent.request;
  }
  return sanitizedEvent;
}

export function createNetworkRequestLogger(taskId: string, networkRequestLoggingEnabled: boolean) {
  return async (event: NetworkRequestLogEvent): Promise<void> => {
    const debugModeEnabled = await isTaskDebugModeEnabled();
    if (!networkRequestLoggingEnabled && !debugModeEnabled) {
      return;
    }

    const { emitTaskEvent } = await import("../runtime/events.js");
    const sanitizedEvent = sanitizeNetworkRequestEventForStorage(event, debugModeEnabled);
    const message = formatNetworkRequestLogMessage(sanitizedEvent);

    await emitTaskEvent(taskId, "log", {
      message,
      networkRequest: {
        ...sanitizedEvent
      }
    });
  };
}
