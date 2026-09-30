import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type IoLogEvent = {
  ts: string;
  type: string;
  [key: string]: JsonValue;
};

let ioLogStream: fs.WriteStream | null = null;

function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map(v => toJsonValue(v));
  if (value && typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = toJsonValue(v);
    }
    return out;
  }
  // Fall back to string for functions/undefined/symbols/etc.
  return String(value);
}

export function initIoLog(filePath: string | undefined): void {
  if (!filePath) return;
  if (ioLogStream) return; // init once

  // Resolve relative paths against cwd (note: MCP hosts may have surprising cwd; prefer absolute paths).
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);

  // Fail fast if we can't open the file.
  const fd = fs.openSync(resolved, 'a');
  fs.closeSync(fd);

  ioLogStream = fs.createWriteStream(resolved, { flags: 'a' });
  ioLogStream.on('error', err => {
    // Don't crash the MCP server due to logging issues.
    console.error(`[error] ioLog write error: ${String(err)}`);
    ioLogStream = null;
  });
}

export function writeIoLog(event: { type: string; [key: string]: unknown }): void {
  if (!ioLogStream) return;

  const payload: IoLogEvent = {
    ts: new Date().toISOString(),
    type: event.type,
    ...Object.fromEntries(Object.entries(event).filter(([k]) => k !== 'type').map(([k, v]) => [k, toJsonValue(v)]))
  };

  ioLogStream.write(`${JSON.stringify(payload)}\n`);
}

export function sanitizeMcpContentForIoLog(content: unknown): unknown {
  // MCP content can contain large binary blobs (e.g. images). For logging, keep the shape
  // but replace large base64 payloads with a lightweight placeholder.
  if (!Array.isArray(content)) return content;

  return content.map(part => {
    if (!part || typeof part !== 'object') return part;
    const p = part as Record<string, unknown>;
    if (p.type === 'image' && typeof p.data === 'string') {
      return {
        ...p,
        data: `<base64:${p.data.length}>`
      };
    }
    return p;
  });
}

