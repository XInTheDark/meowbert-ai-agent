import { randomUUID } from "node:crypto";
import type { FastifyReply } from "fastify";
import { query } from "../../lib/db.js";
import { deviceEvents, type DeviceEventKind } from "./device-events.js";

export async function streamDeviceRuns(deviceId: string, userId: string, reply: FastifyReply, acknowledgePresence = false): Promise<void> {
  const connectionId = randomUUID();
  let closed = false;
  let opened = false;
  let unsubscribe: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const events = new Set<DeviceEventKind>();
  let flushing = false;
  const close = () => { if (closed) return; closed = true; clearTimeout(timer); unsubscribe?.(); if (opened) reply.raw.end(); };
  const send = (event: string, data: unknown) => {
    if (!closed && !reply.raw.destroyed) reply.raw.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
  };
  const flush = async () => {
    if (flushing || !opened || closed) return;
    flushing = true;
    try {
      while (events.size && !closed) {
        const batch = new Set(events); events.clear();
        for (const kind of ["config", "cleanup"] as const) if (batch.has(kind)) send(kind, {});
        if (batch.has("runs")) send("runs", (await query(
          "SELECT run_id, task_id, payload_json, queue_state, pending_reason, admitted_at::text FROM task_run_dispatches " +
          "WHERE queue_state IN ('pending', 'admitted', 'running') AND payload_json->'executionTarget'->>'kind' = 'local' " +
          "AND payload_json->'executionTarget'->>'deviceId' = $1 ORDER BY (queue_state = 'admitted') DESC, queued_at ASC LIMIT 20", [deviceId]
        )).rows);
      }
    } catch { close(); } finally { flushing = false; }
  };
  try {
    unsubscribe = await deviceEvents.subscribe({ deviceId, close, event: (kind) => {
      if (kind === "revoked") { close(); return; }
      events.add(kind); void flush();
    } });
    if (closed) { unsubscribe(); throw new Error("Device notification connection unavailable."); }
    const alive = await query(
      "UPDATE devices SET stream_connection_id = $3, last_seen_at = now(), stream_expires_at = now() + interval '25 seconds' " +
      "WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id", [deviceId, userId, connectionId]);
    if (!alive.rowCount) { close(); reply.status(404).send({ error: "Device not found" }); return; }
    if (closed || reply.raw.destroyed) { close(); if (!reply.raw.destroyed) throw new Error("Device notification connection unavailable."); return; }
    reply.hijack(); opened = true;
    reply.raw.on("close", close);
    reply.raw.once("close", () => {
      void query("UPDATE devices SET stream_expires_at = now() WHERE id = $1 AND user_id = $2 AND stream_connection_id = $3", [deviceId, userId, connectionId]).catch(() => undefined);
    });
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" });
    send("ready", { deviceId, executionEventsVersion: 1 }); events.add("runs"); await flush();
    const heartbeat = async () => {
      if (closed) return;
      // Older desktops already PATCH last_seen_at themselves but cannot ACK pushed pings.
      if (!acknowledgePresence) {
        try {
          const alive = await query("UPDATE devices SET stream_expires_at = now() + interval '25 seconds' WHERE id = $1 AND user_id = $2 AND stream_connection_id = $3 AND revoked_at IS NULL AND last_seen_at > now() - interval '30 seconds' RETURNING id", [deviceId, userId, connectionId]);
          if (!alive.rowCount) { close(); return; }
        } catch { close(); return; }
      }
      send("ping", { connectionId });
      if (!closed) { timer = setTimeout(() => void heartbeat(), 10_000); timer.unref(); }
    };
    if (!closed) { timer = setTimeout(() => void heartbeat(), 10_000); timer.unref(); }
  } catch (error) { close(); if (!opened) throw error; }
}
