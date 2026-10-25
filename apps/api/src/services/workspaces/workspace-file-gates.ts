import type { FastifyInstance, FastifyRequest } from "fastify";
import { workspaceFileFeatures, workspaceFilesScope } from "@meowbert/shared";
import { loadWorkspaceFileLocation } from "./workspace-file-location.js";

export function fileWorkflowScope(url: string) {
  const path = new URL(url, "http://workspace.invalid").pathname;
  const scope = workspaceFilesScope(path);
  if (scope) return scope;
  const match = path.match(/^\/api\/(workspaces|projects|environments|tasks)\/([a-f0-9-]{36})\/(.+)$/i);
  if (!match) return null;
  const suffix = match[3];
  const filesRequired = /^(memory\/refresh|canvases|canvas|shell-sessions|terminal|persistent-shell-sessions|live-sync|members|membership|invites|storage|master)(\/|$)/.test(suffix)
    || /^sources\/[^/]+\/attach$/.test(suffix);
  if (!filesRequired) return null;
  return match[1] === "workspaces" ? { workspaceId: match[2] } : match[1] === "tasks" ? { taskId: match[2] } : { projectId: match[2] };
}

/** Run after each route's authentication and before any filesystem handler. */
export function installWorkspaceFileGates(app: FastifyInstance): void {
  app.addHook("onRoute", (options) => {
    const existing = options.preHandler ? (Array.isArray(options.preHandler) ? options.preHandler : [options.preHandler]) : [];
    options.preHandler = [...existing, async (request: FastifyRequest, reply) => {
      const scope = fileWorkflowScope(request.url);
      if (!scope || !request.user?.id) return;
      const location = await loadWorkspaceFileLocation(request.user.id, scope);
      const features = workspaceFileFeatures(location.fileHost);
      if (features.serverFiles) return;
      // This attachment path has a metadata-only branch; every other source attachment remains gated in its service.
      const body = request.body as { fileMode?: unknown } | null;
      if (/\/sources\/google-drive\/attach$/.test(new URL(request.url, "http://workspace.invalid").pathname)
        && body?.fileMode === "live_sync") return;
      return reply.status(409).send({ error: "Files are on " + (location.deviceName ?? "the workspace device") + ". Open Meowbert Desktop on that device.",
        code: "DEVICE_WORKSPACE_FILES", fileHost: location.fileHost, features });
    }];
  });
}
