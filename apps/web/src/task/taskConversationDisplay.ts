import type { TaskMessage } from "../lib/types";
import { getMessageText } from "../lib/utils";

export interface ModelRetryMessageDetails {
  attempt: number;
  maxAttempts: number;
  error: string;
  retryInSeconds: number;
}

export interface ConsecutiveModelRetryGroup {
  hiddenCount: number;
  latestMessage: TaskMessage;
  latestDetails: ModelRetryMessageDetails;
  nextIndex: number;
  isActive: boolean;
}

const MODEL_RETRY_MESSAGE_PATTERN =
  /^Model request failed \(attempt (\d+)\/(\d+)\): ([\s\S]+?)\. Retrying in (\d+)s\.\.\.$/;

export function parseModelRetryMessage(value: string): ModelRetryMessageDetails | null {
  const match = MODEL_RETRY_MESSAGE_PATTERN.exec(value);
  if (!match) {
    return null;
  }

  const attempt = Number.parseInt(match[1] ?? "", 10);
  const maxAttempts = Number.parseInt(match[2] ?? "", 10);
  const retryInSeconds = Number.parseInt(match[4] ?? "", 10);
  const error = (match[3] ?? "").trim();

  if (
    !Number.isFinite(attempt)
    || !Number.isFinite(maxAttempts)
    || !Number.isFinite(retryInSeconds)
    || error.length === 0
  ) {
    return null;
  }

  return {
    attempt,
    maxAttempts,
    error,
    retryInSeconds
  };
}

export function getModelRetryMessageDetails(message: TaskMessage): ModelRetryMessageDetails | null {
  if (message.role !== "system") {
    return null;
  }

  return parseModelRetryMessage(getMessageText(message));
}

export function getConsecutiveModelRetryGroup(
  messages: TaskMessage[],
  startIndex: number
): ConsecutiveModelRetryGroup | null {
  const firstMessage = messages[startIndex];
  if (!firstMessage) {
    return null;
  }

  let latestMessage = firstMessage;
  let latestDetails = getModelRetryMessageDetails(firstMessage);
  if (!latestDetails) {
    return null;
  }

  let currentIndex = startIndex + 1;
  while (currentIndex < messages.length) {
    const nextMessage = messages[currentIndex];
    if (!nextMessage) {
      break;
    }

    const nextDetails = getModelRetryMessageDetails(nextMessage);
    if (!nextDetails) {
      break;
    }

    latestMessage = nextMessage;
    latestDetails = nextDetails;
    currentIndex += 1;
  }

  return {
    hiddenCount: currentIndex - startIndex - 1,
    latestMessage,
    latestDetails,
    nextIndex: currentIndex,
    isActive: currentIndex === messages.length
  };
}
