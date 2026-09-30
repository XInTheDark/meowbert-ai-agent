import type { NetworkRequestErrorResponse } from "./network-request-log.js";

const REDACTED_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeHeaderValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeHeaderValue(entry)).filter((entry): entry is string => entry !== null).join(", ");
  }
  return null;
}

function sanitizeHeaderEntries(entries: Iterable<[string, unknown]>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of entries) {
    const normalizedName = name.toLowerCase();
    const normalizedValue = normalizeHeaderValue(value);
    if (normalizedValue === null) {
      continue;
    }
    headers[normalizedName] = REDACTED_HEADER_NAMES.has(normalizedName) ? "***" : normalizedValue;
  }
  return headers;
}

function extractHeaders(value: unknown): Record<string, string> | undefined {
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    const headers = sanitizeHeaderEntries(value.entries());
    return Object.keys(headers).length > 0 ? headers : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const headers = sanitizeHeaderEntries(Object.entries(value));
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function toJsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
  ) {
    return value;
  }

  if (value === undefined || typeof value === "function" || typeof value === "symbol") {
    return undefined;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message
    };
  }

  if (typeof Headers !== "undefined" && value instanceof Headers) {
    return extractHeaders(value);
  }

  if (typeof value === "object") {
    if (seen.has(value)) {
      return "[Circular]";
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((entry) => toJsonSafe(entry, seen));
    }

    const output: Record<string, unknown> = {};
    for (const [key, entryValue] of Object.entries(value)) {
      const normalizedValue = toJsonSafe(entryValue, seen);
      if (normalizedValue !== undefined) {
        output[key] = normalizedValue;
      }
    }
    return output;
  }

  return String(value);
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function extractBody(record: Record<string, unknown>): unknown {
  if ("error" in record && record.error !== undefined) {
    return { error: toJsonSafe(record.error) };
  }

  const response = record.response;
  if (isRecord(response)) {
    if ("data" in response) {
      return toJsonSafe(response.data);
    }
    if ("body" in response) {
      return toJsonSafe(response.body);
    }
  }

  if ("body" in record) {
    return toJsonSafe(record.body);
  }

  return undefined;
}

export function extractNetworkRequestErrorResponse(error: unknown): NetworkRequestErrorResponse | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const response = isRecord(error.response) ? error.response : null;
  const status = readNumber(error, "status") ?? (response ? readNumber(response, "status") : undefined);
  const requestId = readString(error, "requestID") ?? readString(error, "requestId") ?? null;
  const headers = extractHeaders(error.headers) ?? (response ? extractHeaders(response.headers) : undefined);
  const body = extractBody(error);

  if (status === undefined && requestId === null && headers === undefined && body === undefined) {
    return undefined;
  }

  return {
    ...(status !== undefined ? { status } : {}),
    requestId,
    ...(headers ? { headers } : {}),
    ...(body !== undefined ? { body } : {})
  };
}
