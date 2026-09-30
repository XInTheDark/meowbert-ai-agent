export interface TaskMessageMetadata {
  message_time: string;
  agent_id?: string;
  reasoning_content_count?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeOptionalNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : undefined;
}

export function createTaskMessageMetadata(
  messageTime: string,
  options: {
    agentId?: string | null;
    reasoningContentCount?: number | null;
  } = {}
): TaskMessageMetadata {
  const metadata: TaskMessageMetadata = {
    message_time: messageTime
  };
  const agentId = normalizeOptionalString(options.agentId);
  if (agentId) {
    metadata.agent_id = agentId;
  }
  const reasoningContentCount = normalizeOptionalNonNegativeInteger(options.reasoningContentCount);
  if (reasoningContentCount !== undefined) {
    metadata.reasoning_content_count = reasoningContentCount;
  }
  return metadata;
}

export function normalizeTaskMessageMetadata(value: unknown): TaskMessageMetadata | null {
  if (!isPlainObject(value) || typeof value.message_time !== "string") {
    return null;
  }

  const messageTime = value.message_time.trim();
  if (messageTime.length === 0) {
    return null;
  }

  const metadata: TaskMessageMetadata = {
    message_time: messageTime
  };
  const agentId = normalizeOptionalString(value.agent_id);
  if (agentId) {
    metadata.agent_id = agentId;
  }
  const reasoningContentCount = normalizeOptionalNonNegativeInteger(value.reasoning_content_count);
  if (reasoningContentCount !== undefined) {
    metadata.reasoning_content_count = reasoningContentCount;
  }
  return metadata;
}

export function buildTaskMessageMetadataLine(value: unknown): string | null {
  const metadata = normalizeTaskMessageMetadata(value);
  if (!metadata) {
    return null;
  }

  return JSON.stringify({ metadata });
}

export function appendTaskMessageMetadataLine(text: string, value: unknown): string {
  const metadataLine = buildTaskMessageMetadataLine(value);
  if (!metadataLine) {
    return text;
  }

  return text.length > 0 ? `${text}\n${metadataLine}` : metadataLine;
}
