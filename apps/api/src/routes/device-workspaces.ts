import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { query } from "../lib/db.js";
import { requestWorkspaceRelink } from "../services/workspaces/workspace-relink.js";
import { listDevices } from "../services/devices/device-service.js";

export const deviceWorkspaceRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/workspaces/:workspaceId/relink", { preHandler: app.authenticate }, async (request, reply) => {
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    const { deviceId } = z.object({ deviceId: z.string().uuid() }).strict().parse(request.body);
    const result = await requestWorkspaceRelink(workspaceId, deviceId, request.user.id);
    return reply.status(result.pending ? 202 : 200).send(result);
  });
  app.get("/api/devices/:deviceId/tombstones", { preHandler: app.authenticate }, async (request, reply) => {
    const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(request.params);
    if (!(await listDevices(request.user.id)).some((device) => device.id === deviceId)) return reply.status(404).send({ error: "Device not found" });
    const { after } = z.object({ after: z.string().uuid().optional() }).parse(request.query);
    const result = await query("SELECT id, workspace_id, kind, target_id, relative_path FROM device_file_tombstones WHERE device_id = $1 AND acked_at IS NULL AND not_before <= now() AND ($2::uuid IS NULL OR (created_at, id) > (SELECT created_at, id FROM device_file_tombstones WHERE id = $2 AND device_id = $1)) ORDER BY created_at, id LIMIT 100", [deviceId, after ?? null]);
    const next = await query("SELECT min(not_before)::text AS due, EXTRACT(EPOCH FROM (min(not_before) - now())) * 1000 AS delay_ms FROM device_file_tombstones WHERE device_id = $1 AND acked_at IS NULL AND not_before > now()", [deviceId]);
    return { items: result.rows, nextDueAt: next.rows[0]?.due ?? null, nextCheckInMs: next.rows[0]?.delay_ms == null ? null : Math.max(0, Number(next.rows[0].delay_ms)), nextCursor: result.rows.length === 100 ? result.rows[99].id : null };
  });
  app.post("/api/devices/:deviceId/tombstones/ack", { preHandler: app.authenticate }, async (request, reply) => {
    const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(request.params);
    const { ids } = z.object({ ids: z.array(z.string().uuid()).max(100) }).strict().parse(request.body);
    if (!(await listDevices(request.user.id)).some((device) => device.id === deviceId)) return reply.status(404).send({ error: "Device not found" });
    await query("UPDATE device_file_tombstones SET acked_at = COALESCE(acked_at, now()) WHERE device_id = $1 AND id = ANY($2::uuid[])", [deviceId, ids]);
    return { ok: true };
  });
};
