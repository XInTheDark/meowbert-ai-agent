export type NetworkRequestLogLevel = "error" | "warn" | "info" | "debug";

export interface NetworkRequestReplayPayload {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  curl: string;
}

export interface NetworkRequestErrorResponse {
  status?: number;
  requestId?: string | null;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface NetworkRequestResponseStream {
  events: unknown[];
}

interface NetworkRequestBaseLogEvent {
  service: "openai_responses";
  endpoint: string;
  model: string;
  baseUrl: string;
  attempt: number;
}

export interface NetworkRequestLifecycleLogEvent extends NetworkRequestBaseLogEvent {
  phase: "start" | "success" | "error";
  durationMs?: number;
  error?: string;
  errorResponse?: NetworkRequestErrorResponse;
  responseStream?: NetworkRequestResponseStream;
  request?: NetworkRequestReplayPayload;
}

export interface NetworkRequestDiagnosticLogEvent extends NetworkRequestBaseLogEvent {
  phase: "debug";
  source: "openai_sdk";
  logLevel: NetworkRequestLogLevel;
  message: string;
  details?: unknown[];
}

export type NetworkRequestLogEvent = NetworkRequestLifecycleLogEvent | NetworkRequestDiagnosticLogEvent;

export type NetworkRequestLogCallback = (event: NetworkRequestLogEvent) => Promise<void> | void;

export function formatNetworkRequestLogMessage(event: NetworkRequestLogEvent): string {
  switch (event.phase) {
    case "start":
      if (event.request) {
        return `Sending payload: ${event.request.method} ${event.request.url} (attempt ${event.attempt})`;
      }
      return `Network request started: ${event.endpoint} (attempt ${event.attempt})`;
    case "success":
      return `Network request succeeded: ${event.endpoint} (${event.durationMs ?? 0}ms)`;
    case "error":
      return `Network request failed: ${event.endpoint}${event.error ? ` (${event.error})` : ""}`;
    case "debug":
      return `OpenAI SDK ${event.logLevel}: ${event.message}`;
  }
}

export async function emitNetworkRequestEvent(
  callback: NetworkRequestLogCallback | undefined,
  event: NetworkRequestLogEvent
): Promise<void> {
  if (!callback) {
    return;
  }

  try {
    await callback(event);
  } catch {
    // Debug callbacks should never affect task execution.
  }
}
