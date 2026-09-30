interface TaskMessageLike {
  role: string;
  content_json: Record<string, unknown>;
}

const MODEL_RETRY_MESSAGE_PATTERN =
  /^Model request failed \(attempt (\d+)\/(\d+)\): ([\s\S]+?)\. Retrying in (\d+)s\.\.\.$/;

const GENERIC_RETRY_ERROR = "Something went wrong";
const GENERIC_FAILURE_MESSAGE = "Something went wrong.";

interface RetryMessageDetails {
  attempt: number;
  maxAttempts: number;
  retryInSeconds: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRetryMessage(text: string): RetryMessageDetails | null {
  const match = MODEL_RETRY_MESSAGE_PATTERN.exec(text);
  if (!match) {
    return null;
  }

  const attempt = Number.parseInt(match[1] ?? "", 10);
  const maxAttempts = Number.parseInt(match[2] ?? "", 10);
  const retryInSeconds = Number.parseInt(match[4] ?? "", 10);
  if (!Number.isFinite(attempt) || !Number.isFinite(maxAttempts) || !Number.isFinite(retryInSeconds)) {
    return null;
  }

  return {
    attempt,
    maxAttempts,
    retryInSeconds
  };
}

function sanitizeMessageContent(role: string, content: Record<string, unknown>): Record<string, unknown> {
  const text = typeof content.text === "string" ? content.text : null;
  if (text === null) {
    return content;
  }

  const retryDetails = role === "system" ? parseRetryMessage(text) : null;
  if (retryDetails) {
    return {
      ...content,
      text:
        `Model request failed (attempt ${retryDetails.attempt}/${retryDetails.maxAttempts}): `
        + `${GENERIC_RETRY_ERROR}. Retrying in ${retryDetails.retryInSeconds}s...`
    };
  }

  if (role === "assistant" && text.startsWith("Task failed: ")) {
    return {
      ...content,
      text: GENERIC_FAILURE_MESSAGE
    };
  }

  return content;
}

export function sanitizeTaskMessageForDebugMode<T extends TaskMessageLike>(message: T, debugMode: boolean): T {
  if (debugMode) {
    return message;
  }

  return {
    ...message,
    content_json: sanitizeMessageContent(message.role, message.content_json)
  };
}

export function sanitizeContextUsagePayloadForDebugMode<T extends Record<string, unknown>>(
  payload: T,
  debugMode: boolean
): T {
  if (debugMode) {
    return payload;
  }

  const nextPayload = { ...payload };
  delete nextPayload.promptRevision;
  delete nextPayload.prefixHash;
  return nextPayload as T;
}

export function sanitizeTaskEventPayloadForDebugMode(
  type: string,
  payload: Record<string, unknown>,
  debugMode: boolean
): Record<string, unknown> {
  if (debugMode) {
    return payload;
  }

  if (type === "context_usage") {
    return sanitizeContextUsagePayloadForDebugMode(payload, debugMode);
  }

  if (type === "log") {
    const networkRequest = payload.networkRequest;
    if (!isPlainObject(networkRequest)) {
      return payload;
    }

    const sanitizedNetworkRequest = { ...networkRequest };
    delete sanitizedNetworkRequest.details;
    delete sanitizedNetworkRequest.errorResponse;
    delete sanitizedNetworkRequest.request;
    delete sanitizedNetworkRequest.responseStream;
    return {
      ...payload,
      networkRequest: sanitizedNetworkRequest
    };
  }

  if (type === "error" && typeof payload.message === "string" && payload.message.trim().length > 0) {
    return {
      ...payload,
      message: GENERIC_FAILURE_MESSAGE
    };
  }

  return payload;
}
