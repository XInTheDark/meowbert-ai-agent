import { createHash } from "node:crypto";
import type { TaskHistoryArchiveQueryable } from "./task-history-archive.js";

// Images and files the agent viewed are stored once per task in task_media_blobs. Stored response
// items carry this reference in place of the data URL, and are rehydrated before a model request.
export const TASK_MEDIA_REFERENCE_PREFIX = "meowbert-media:sha256:";

const INLINE_MEDIA_KEYS = new Set(["image_url", "file_data"]);
const DATA_URL_PATTERN = /^data:([^;,]+);base64,/;
const UNAVAILABLE_MEDIA_TEXT = "[Previously viewed media is no longer available.]";

interface TaskMediaBlob {
  sha256: string;
  mimeType: string;
  bytes: Buffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Only canonical base64 is moved out, so rehydrating always reproduces the exact original string.
function parseInlineMedia(dataUrl: string): TaskMediaBlob | null {
  const match = DATA_URL_PATTERN.exec(dataUrl);
  if (!match) {
    return null;
  }
  const base64 = dataUrl.slice(match[0].length);
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64) {
    return null;
  }
  return { sha256: createHash("sha256").update(bytes).digest("hex"), mimeType: match[1], bytes };
}

function parseMediaReference(value: unknown): string | null {
  return typeof value === "string" && value.startsWith(TASK_MEDIA_REFERENCE_PREFIX)
    ? value.slice(TASK_MEDIA_REFERENCE_PREFIX.length)
    : null;
}

function mapMediaValues(value: unknown, replace: (key: string, entry: string) => string): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => mapMediaValues(entry, replace));
  }
  if (!isRecord(value)) {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = INLINE_MEDIA_KEYS.has(key) && typeof entry === "string"
      ? replace(key, entry)
      : mapMediaValues(entry, replace);
  }
  return result;
}

function collectMediaReferences(contents: Array<Record<string, unknown>>): Set<string> {
  const hashes = new Set<string>();
  for (const content of contents) {
    mapMediaValues(content.response_items, (_key, entry) => {
      const hash = parseMediaReference(entry);
      if (hash) hashes.add(hash);
      return entry;
    });
  }
  return hashes;
}

// Returns a copy of the message content whose response items reference stored media instead of
// carrying it inline. The caller's content (often still in use by the running loop) is not modified.
export async function externalizeTaskMedia(
  db: TaskHistoryArchiveQueryable,
  taskId: string,
  content: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!Array.isArray(content.response_items)) {
    return content;
  }

  const blobs = new Map<string, TaskMediaBlob>();
  const responseItems = mapMediaValues(content.response_items, (_key, entry) => {
    const blob = parseInlineMedia(entry);
    if (!blob) {
      return entry;
    }
    blobs.set(blob.sha256, blob);
    return `${TASK_MEDIA_REFERENCE_PREFIX}${blob.sha256}`;
  });
  if (blobs.size === 0) {
    return content;
  }

  for (const blob of blobs.values()) {
    await db.query(
      `INSERT INTO task_media_blobs (task_id, sha256, mime_type, bytes)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (task_id, sha256) DO NOTHING`,
      [taskId, blob.sha256, blob.mimeType, blob.bytes]
    );
  }
  return { ...content, response_items: responseItems };
}

function replaceUnavailableMediaParts(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(replaceUnavailableMediaParts);
  }
  if (!isRecord(value)) {
    return value;
  }
  const hasMissingMedia = [...INLINE_MEDIA_KEYS].some((key) => parseMediaReference(value[key]) !== null);
  if (hasMissingMedia) {
    return { type: "input_text", text: UNAVAILABLE_MEDIA_TEXT };
  }
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceUnavailableMediaParts(entry)]));
}

// Puts stored media back into the response items of loaded messages, with one query per call.
export async function rehydrateTaskMedia<T extends { content_json: Record<string, unknown> }>(
  db: TaskHistoryArchiveQueryable,
  taskId: string,
  messages: T[]
): Promise<T[]> {
  const hashes = collectMediaReferences(messages.map((message) => message.content_json));
  if (hashes.size === 0) {
    return messages;
  }

  const result = await db.query<{ sha256: string; mime_type: string; bytes: Buffer }>(
    `SELECT sha256, mime_type, bytes
       FROM task_media_blobs
      WHERE task_id = $1
        AND sha256 = ANY($2::text[])`,
    [taskId, [...hashes]]
  );
  const dataUrls = new Map(result.rows.map((row) => [row.sha256, `data:${row.mime_type};base64,${row.bytes.toString("base64")}`]));

  return messages.map((message) => {
    if (!Array.isArray(message.content_json.response_items)) {
      return message;
    }
    const restored = mapMediaValues(message.content_json.response_items, (_key, entry) => {
      const hash = parseMediaReference(entry);
      return hash ? dataUrls.get(hash) ?? entry : entry;
    });
    return {
      ...message,
      content_json: { ...message.content_json, response_items: replaceUnavailableMediaParts(restored) }
    };
  });
}

// Copies the media referenced by messages cloned into another task (forks and threads).
export async function copyTaskMediaBlobs(
  db: TaskHistoryArchiveQueryable,
  input: { sourceTaskId: string; targetTaskId: string; contents: Array<Record<string, unknown>> }
): Promise<void> {
  const hashes = collectMediaReferences(input.contents);
  if (hashes.size === 0) {
    return;
  }
  await db.query(
    `INSERT INTO task_media_blobs (task_id, sha256, mime_type, bytes)
     SELECT $2, sha256, mime_type, bytes
       FROM task_media_blobs
      WHERE task_id = $1
        AND sha256 = ANY($3::text[])
     ON CONFLICT (task_id, sha256) DO NOTHING`,
    [input.sourceTaskId, input.targetTaskId, [...hashes]]
  );
}
