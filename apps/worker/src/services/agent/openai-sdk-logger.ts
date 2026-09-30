import type OpenAI from "openai";
import type { NetworkRequestLogCallback, NetworkRequestLogEvent, NetworkRequestLogLevel } from "./network-request-log.js";

const MAX_LOG_SUMMARY_LENGTH = 280;
const MAX_LOG_STRING_LENGTH = 4000;
const MAX_LOG_ARRAY_ITEMS = 12;
const MAX_LOG_OBJECT_KEYS = 20;
const MAX_LOG_DEPTH = 4;

export interface OpenAiRequestDebugContext {
  endpoint: string;
  model: string;
  baseUrl: string;
  attempt: number;
  onNetworkRequest: NetworkRequestLogCallback;
}

function truncateString(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}… [truncated ${value.length - maxLength} chars]`;
}

function normalizeBinaryValue(value: ArrayBuffer | ArrayBufferView): Record<string, unknown> {
  const bytes = value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);

  return {
    type: value instanceof ArrayBuffer ? "ArrayBuffer" : value.constructor.name,
    byteLength: bytes.byteLength,
    preview: truncateString(Buffer.from(bytes.slice(0, 256)).toString("utf8"), 512)
  };
}

function normalizeLogValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return truncateString(value, MAX_LOG_STRING_LENGTH);
  }

  if (value === undefined) {
    return "[undefined]";
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncateString(value.message, MAX_LOG_STRING_LENGTH),
      stack: typeof value.stack === "string" ? truncateString(value.stack, MAX_LOG_STRING_LENGTH) : undefined
    };
  }

  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return Object.fromEntries(
      [...value.entries()].map(([key, entryValue]) => [key, truncateString(entryValue, 512)])
    );
  }

  if (typeof URL !== "undefined" && value instanceof URL) {
    return value.toString();
  }

  if (typeof Request !== "undefined" && value instanceof Request) {
    return {
      type: "Request",
      method: value.method,
      url: value.url
    };
  }

  if (typeof Response !== "undefined" && value instanceof Response) {
    return {
      type: "Response",
      status: value.status,
      ok: value.ok,
      url: value.url
    };
  }

  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return normalizeBinaryValue(value);
  }

  if (depth >= MAX_LOG_DEPTH) {
    const tag = Object.prototype.toString.call(value);
    return typeof value === "object" && value !== null ? `[${tag.slice(8, -1)}]` : String(value);
  }

  if (Array.isArray(value)) {
    const entries = value
      .slice(0, MAX_LOG_ARRAY_ITEMS)
      .map((entry) => normalizeLogValue(entry, depth + 1, seen));
    if (value.length > MAX_LOG_ARRAY_ITEMS) {
      entries.push(`[${value.length - MAX_LOG_ARRAY_ITEMS} more items]`);
    }
    return entries;
  }

  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    const tag = Object.prototype.toString.call(value);
    if (tag === "[object ReadableStream]") {
      return "[ReadableStream]";
    }

    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const entries = Object.entries(record);
    for (const [key, entryValue] of entries.slice(0, MAX_LOG_OBJECT_KEYS)) {
      result[key] = normalizeLogValue(entryValue, depth + 1, seen);
    }
    if (entries.length > MAX_LOG_OBJECT_KEYS) {
      result.__truncatedKeys = entries.length - MAX_LOG_OBJECT_KEYS;
    }
    return result;
  }

  return truncateString(String(value), MAX_LOG_STRING_LENGTH);
}

function summarizeLogArgs(args: unknown[]): string {
  if (args.length === 0) {
    return "OpenAI SDK log";
  }

  const firstArg = args[0];
  if (typeof firstArg === "string") {
    const trimmed = firstArg.trim();
    if (trimmed.length > 0) {
      return truncateString(trimmed, MAX_LOG_SUMMARY_LENGTH);
    }
  }

  return truncateString(JSON.stringify(normalizeLogValue(firstArg)), MAX_LOG_SUMMARY_LENGTH);
}

function queueNetworkRequestLog(context: OpenAiRequestDebugContext, event: NetworkRequestLogEvent): void {
  void Promise.resolve(context.onNetworkRequest(event)).catch(() => undefined);
}

function createOpenAiSdkLogMethod(
  context: OpenAiRequestDebugContext,
  logLevel: NetworkRequestLogLevel
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    const details = args.map((arg) => normalizeLogValue(arg));
    queueNetworkRequestLog(context, {
      phase: "debug",
      service: "openai_responses",
      endpoint: context.endpoint,
      model: context.model,
      baseUrl: context.baseUrl,
      attempt: context.attempt,
      source: "openai_sdk",
      logLevel,
      message: summarizeLogArgs(args),
      ...(details.length > 0 ? { details } : {})
    });
  };
}

function createOpenAiSdkLogger(context: OpenAiRequestDebugContext) {
  return {
    error: createOpenAiSdkLogMethod(context, "error"),
    warn: createOpenAiSdkLogMethod(context, "warn"),
    info: createOpenAiSdkLogMethod(context, "info"),
    debug: createOpenAiSdkLogMethod(context, "debug")
  };
}

export function withOpenAiRequestDebugLogging(client: OpenAI, context: OpenAiRequestDebugContext): OpenAI {
  if (typeof client.withOptions !== "function") {
    return client;
  }

  return client.withOptions({
    logLevel: "debug",
    logger: createOpenAiSdkLogger(context)
  });
}
