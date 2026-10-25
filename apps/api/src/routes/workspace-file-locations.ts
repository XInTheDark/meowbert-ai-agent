import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { loadWorkspaceFileLocation } from "../services/workspaces/workspace-file-location.js";
import { recordTaskUpload, removeTaskInputUploads } from "../services/files/task-upload-manifest.js";
import { listDevices } from "../services/devices/device-service.js";

const locationQuery = z.object({ workspaceId: z.string().uuid().optional(), projectId: z.string().uuid().optional(), taskId: z.string().uuid().optional() })
  .refine((input) => Object.keys(input).length === 1, "Specify one file scope.");
const uploadMetadata = z.object({ deviceId: z.string().uuid(), name: z.string().min(1), relativePath: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string().nullable(), modifiedAt: z.string().nullable() }).strict();
const deletedInputs = z.object({ deviceId: z.string().uuid(), paths: z.array(z.string().min(1)) }).strict();

export const workspaceFileLocationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/workspace-files/location", { preHandler: app.authenticate }, async (request) =>
    loadWorkspaceFileLocation(request.user.id, locationQuery.parse(request.query)));
  app.post("/api/projects/:projectId/device-inputs", { preHandler: app.authenticate }, async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = uploadMetadata.parse(request.body);
    const location = await loadWorkspaceFileLocation(request.user.id, { projectId });
    if (location.fileHost.kind !== "device" || location.fileHost.deviceId !== body.deviceId
      || !(await listDevices(request.user.id)).some((device) => device.id === body.deviceId)) {
      return reply.status(409).send({ error: "The workspace files are not on this device." });
    }
    if (body.relativePath.split(/[\\/]/).includes("..") || body.relativePath.startsWith("/") || body.relativePath.includes("\\")) {
      return reply.status(400).send({ error: "Invalid input path." });
    }
    const { deviceId: _deviceId, ...file } = body;
    await recordTaskUpload(projectId, file);
    return { ok: true };
  });
  app.post("/api/projects/:projectId/device-inputs/delete", { preHandler: app.authenticate }, async (request, reply) => {
    const { projectId } = z.object({ projectId: z.string().uuid() }).parse(request.params);
    const body = deletedInputs.parse(request.body);
    const location = await loadWorkspaceFileLocation(request.user.id, { projectId });
    if (location.fileHost.kind !== "device" || location.fileHost.deviceId !== body.deviceId
      || !(await listDevices(request.user.id)).some((device) => device.id === body.deviceId)) {
      return reply.status(409).send({ error: "The workspace files are not on this device." });
    }
    await removeTaskInputUploads(projectId, body.paths);
    return { ok: true };
  });
};
