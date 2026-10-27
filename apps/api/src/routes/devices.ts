import { claimLocalRun, refuseLocalRunForStorage, resolveWorkerRunApiUrl } from "../services/devices/device-claims.js";
import path from "node:path";
import { readStorageMarker } from "@meowbert/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { config } from "../lib/config.js";
import { query } from "../lib/db.js";
import { assertEnvironmentMember } from "../services/workspaces/workspace-access.js";
import { listProjectExecutionTargets } from "../services/devices/execution-targets.js";
import {
  listDevices,
  registerDevice,
  revokeDevice,
  updateDevice
} from "../services/devices/device-service.js";

import { streamDeviceRuns } from "../services/devices/device-stream.js";

const deviceParams = z.object({ deviceId: z.string().uuid() });
const runParams = z.object({ deviceId: z.string().uuid(), runId: z.string().uuid() });
const deviceBody = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(160),
  platform: z.string().trim().min(1).max(80),
  architecture: z.string().trim().min(1).max(80),
  executorVersion: z.string().trim().min(1).max(80),
  capabilities: z.record(z.string(), z.unknown()).optional(),
  consent: z.record(z.string(), z.unknown()).optional(),
  maxConcurrentRuns: z.number().int().positive().max(16).optional(),
  verifiedRoots: z.record(z.string(), z.unknown()).optional()
}).strict();
const devicePatch = deviceBody.omit({ id: true, platform: true, architecture: true }).partial();

export const deviceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/api/projects/:projectId/execution-targets", { preHandler: fastify.authenticate }, async (request) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    await assertEnvironmentMember(projectId, request.user.id);
    return listProjectExecutionTargets(request.user.id, projectId);
  });
  fastify.get("/api/local-execution/config", { preHandler: fastify.authenticate }, async (request) => {
    const configured = config.localExecution.enabled && config.runApi !== undefined;
    const digestResult = await query<{ sandbox_image_reference: string | null; sandbox_image_digest: string | null }>(
      `SELECT sandbox_image_reference, sandbox_image_digest FROM platform_settings WHERE id = 1`
    ).catch(() => ({ rows: [] as Array<{ sandbox_image_reference: string | null; sandbox_image_digest: string | null }> }));
    const image = digestResult.rows[0]?.sandbox_image_reference ?? config.runtime.sandbox.image;
    return {
      enabled: configured,
      deviceWorkspaces: (await query<{ id: string; file_host: unknown }>(
        "SELECT w.id, w.file_host FROM workspaces w JOIN workspace_members wm ON wm.workspace_id = w.id WHERE wm.user_id = $1 AND w.file_host->>'kind' = 'device' ORDER BY w.id", [request.user.id]
      )).rows,
      storageMarkers: Object.fromEntries(await Promise.all(config.storage.backends.map(async (backend) => [backend.id,
        await readStorageMarker(backend.type === "mounted" ? backend.mountPath : path.dirname(backend.workspacesRoot))
      ]))),
      executorSettings: {
        maxSteps: config.runtime.maxSteps, commandTimeoutMs: config.runtime.commandTimeoutMs,
        maxCommandOutputKb: config.runtime.maxCommandOutputKb, shell: config.runtime.shell,
        skills: { browserUse: config.skills?.browserUse, office: config.skills?.office, htmlCanvas: config.skills?.htmlCanvas }
      },
      sandboxImage: {
        reference: image,
        digest: digestResult.rows[0]?.sandbox_image_digest ?? (image.includes("@") ? image.split("@")[1] : null)
      }
    };
  });
  fastify.get("/api/devices", { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!config.localExecution.enabled) return reply.status(404).send({ error: "Local execution is disabled." });
    return { devices: await listDevices(request.user.id) };
  });
  fastify.post("/api/devices", { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!config.localExecution.enabled) return reply.status(404).send({ error: "Local execution is disabled." });
    return registerDevice(request.user.id, deviceBody.parse(request.body));
  });
  fastify.patch("/api/devices/:deviceId", { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!config.localExecution.enabled) return reply.status(404).send({ error: "Local execution is disabled." });
    const { deviceId } = deviceParams.parse(request.params);
    const updated = await updateDevice(request.user.id, deviceId, devicePatch.parse(request.body));
    if (!updated) return reply.status(404).send({ error: "Device not found" });
    return updated;
  });
  fastify.delete("/api/devices/:deviceId", { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!config.localExecution.enabled) return reply.status(404).send({ error: "Local execution is disabled." });
    const { deviceId } = deviceParams.parse(request.params);
    if (!await revokeDevice(request.user.id, deviceId)) return reply.status(404).send({ error: "Device not found" });
    return { ok: true };
  });
  fastify.get("/api/devices/:deviceId/runs/stream", { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!config.localExecution.enabled) return reply.status(404).send({ error: "Local execution is disabled." });
    const { deviceId } = deviceParams.parse(request.params);
    await streamDeviceRuns(deviceId, request.user.id, reply, request.headers["x-meowbert-device-presence"] === "ack-v1");
  });
  fastify.post("/api/devices/:deviceId/presence", { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!config.localExecution.enabled) return reply.status(404).send({ error: "Local execution is disabled." });
    const { deviceId } = deviceParams.parse(request.params);
    const { connectionId } = z.object({ connectionId: z.string().uuid() }).strict().parse(request.body);
    const alive = await query(
      "UPDATE devices SET last_seen_at = now(), stream_expires_at = now() + interval '25 seconds' " +
      "WHERE id = $1 AND user_id = $2 AND stream_connection_id = $3 AND revoked_at IS NULL RETURNING id",
      [deviceId, request.user.id, connectionId]);
    if (!alive.rowCount) return reply.status(409).send({ error: "The device connection is no longer active." });
    return { ok: true };
  });
  fastify.post("/api/devices/:deviceId/runs/:runId/refuse-storage", { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!config.localExecution.enabled) return reply.status(404).send({ error: "Local execution is disabled." });
    const { deviceId, runId } = runParams.parse(request.params);
    if (!await refuseLocalRunForStorage({ userId: request.user.id, deviceId, runId })) {
      return reply.status(409).send({ error: "The run is no longer admitted to this device." });
    }
    return { pending: true };
  });
  fastify.post("/api/devices/:deviceId/runs/:runId/claim", { preHandler: fastify.authenticate }, async (request, reply) => {
    if (!config.localExecution.enabled) return reply.status(404).send({ error: "Local execution is disabled." });
    const { deviceId, runId } = runParams.parse(request.params);
    const workerUrl = resolveWorkerRunApiUrl();
    if (!workerUrl || !config.runApi) {
      return reply.status(503).send({ error: "The local executor service is not configured on this server." });
    }
    const claim = await claimLocalRun({ userId: request.user.id, deviceId, runId });
    if (!claim) return reply.status(409).send({ error: "The run is no longer available for this device." });
    const response = await fetch(`${workerUrl}/runs/${encodeURIComponent(runId)}/claim`, {
      method: "POST",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "content-type": "application/json",
        "x-meowbert-run-api-secret": config.security.jwtSecret,
        "x-meowbert-device-id": deviceId
      },
      body: JSON.stringify({ job: claim.job })
    }).catch(() => null);
    if (!response) return reply.status(503).send({ error: "The worker holding local runs is unreachable." });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return reply.status(response.status).send(payload);
    return payload;
  });
};
