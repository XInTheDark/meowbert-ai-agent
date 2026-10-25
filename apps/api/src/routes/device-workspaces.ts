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
    const result = await query("SELECT id, workspace_id, kind, target_id, relative_path FROM device_file_tombstones WHERE device_id = $1 AND acked_at IS NULL AND not_before <= now() ORDER BY created_at, id LIMIT 100", [deviceId]);
    return { items: result.rows };
  });
  app.post("/api/devices/:deviceId/tombstones/ack", { preHandler: app.authenticate }, async (request, reply) => {
    const { deviceId } = z.object({ deviceId: z.string().uuid() }).parse(request.params);
    const { ids } = z.object({ ids: z.array(z.string().uuid()).max(100) }).strict().parse(request.body);
    if (!(await listDevices(request.user.id)).some((device) => device.id === deviceId)) return reply.status(404).send({ error: "Device not found" });
    await query("UPDATE device_file_tombstones SET acked_at = COALESCE(acked_at, now()) WHERE device_id = $1 AND id = ANY($2::uuid[])", [deviceId, ids]);
    return { ok: true };
  });
};
