import { claimLocalRun, resolveWorkerRunApiUrl } from "../services/devices/device-claims.js";
import path from "node:path";
import { readStorageMarker } from "@meowbert/shared";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
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

const deviceParams = z.object({ deviceId: z.string().uuid() });
const runParams = z.object({ deviceId: z.string().uuid(), runId: z.string().uuid() });
const deviceBody = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(160),
  platform: z.string().trim().min(1).max(80),
  architecture: z.string().trim().min(1).max(80),
  executorVersion: z.string().trim().min(1).max(80),
  capabilities: z.record(z.unknown()).optional(),
  consent: z.record(z.unknown()).optional(),
  maxConcurrentRuns: z.number().int().positive().max(16).optional(),
  verifiedRoots: z.record(z.unknown()).optional()
}).strict();
const devicePatch = deviceBody.omit({ id: true, platform: true, architecture: true }).partial();

function sendSse(response: FastifyReply, event: string, data: unknown): void {
  response.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function streamDeviceRuns(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { deviceId } = deviceParams.parse(request.params);
  const device = (await listDevices(request.user.id)).find((entry) => entry.id === deviceId);
  if (!device) {
    reply.status(404).send({ error: "Device not found" });
    return;
  }

  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive"
  });
  sendSse(reply, "ready", { deviceId, connectedAt: new Date().toISOString() });
  const timer = setInterval(async () => {
    const alive = await query(
      `UPDATE devices SET stream_expires_at = now() + interval '15 seconds'
        WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`, [deviceId, request.user.id]
    ).catch(() => null);
    if (!alive?.rowCount) { reply.raw.end(); return; }
    const result = await query(
      `SELECT run_id, task_id, payload_json, queue_state, pending_reason, admitted_at::text
         FROM task_run_dispatches
        WHERE queue_state IN ('pending', 'admitted', 'running')
          AND payload_json->'executionTarget'->>'kind' = 'local'
          AND payload_json->'executionTarget'->>'deviceId' = $1
        ORDER BY queued_at ASC
        LIMIT 20`,
      [deviceId]
    ).catch(() => ({ rows: [] }));
    if (!reply.raw.destroyed) sendSse(reply, "runs", result.rows);
  }, 2_000);
  timer.unref();
  reply.raw.on("close", () => clearInterval(timer));
}

export const deviceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/api/projects/:projectId/execution-targets", { preHandler: fastify.authenticate }, async (request) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    await assertEnvironmentMember(projectId, request.user.id);
    return listProjectExecutionTargets(request.user.id, projectId);
  });
  fastify.get("/api/local-execution/config", { preHandler: fastify.authenticate }, async () => {
    const configured = config.localExecution.enabled && config.runApi !== undefined;
    const digestResult = await query<{ sandbox_image_reference: string | null; sandbox_image_digest: string | null }>(
      `SELECT sandbox_image_reference, sandbox_image_digest FROM platform_settings WHERE id = 1`
    ).catch(() => ({ rows: [] as Array<{ sandbox_image_reference: string | null; sandbox_image_digest: string | null }> }));
    const image = digestResult.rows[0]?.sandbox_image_reference ?? config.runtime.sandbox.image;
    return {
      enabled: configured,
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
    await streamDeviceRuns(request, reply);
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
