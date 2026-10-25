import path from "node:path";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { loadWorkspaceFileLocation } from "../services/workspaces/workspace-file-location.js";
import { deleteSourceFileLink, listSourceFileLinksUnderEnvironmentPaths } from "../services/source-file-links/store.js";

const paramsSchema = z.object({ projectId: z.string().uuid() });
const unlinkBody = z.object({ paths: z.array(z.string().min(1).max(1200)).min(1).max(100) }).strict();

export function registerDeviceLiveFolderRoutes(app: FastifyInstance): void {
  const folders = async (userId: string, projectId: string) => {
    const location = await loadWorkspaceFileLocation(userId, { projectId });
    if (location.fileHost.kind !== "device") throw Object.assign(new Error("These files are hosted by the server."), { statusCode: 409 });
    const links = await listSourceFileLinksUnderEnvironmentPaths(projectId, ["context", ".meowbert/task-runs"]);
    return links.filter((link) => link.workspaceId === location.workspaceId && link.provider === "google-drive" && link.linkKind === "folder");
  };
  app.get("/api/projects/:projectId/live-drive-folders", { preHandler: app.authenticate }, async (request) => {
    const { projectId } = paramsSchema.parse(request.params);
    return { folders: (await folders(request.user.id, projectId)).map((link) => ({
      id: link.id, provider: link.provider, sourceId: link.sourceId, linkKind: link.linkKind, remoteName: link.remoteName,
      remoteWebUrl: link.remoteWebUrl, localRelativePath: link.localRelativePath,
      lastPulledAt: link.lastPulledAt, lastPushedAt: link.lastPushedAt, lastSyncError: link.lastSyncError
    })) };
  });
  app.post("/api/projects/:projectId/live-drive-folders/unlink", { preHandler: app.authenticate }, async (request) => {
    const { projectId } = paramsSchema.parse(request.params);
    const { paths } = unlinkBody.parse(request.body);
    if (paths.some((value) => value.includes("\\") || path.posix.isAbsolute(value) || value.split("/").includes(".."))) {
      throw Object.assign(new Error("Invalid live-folder path."), { statusCode: 400 });
    }
    for (const link of await folders(request.user.id, projectId)) {
      if (paths.some((value) => link.localRelativePath === value || link.localRelativePath.startsWith(value + "/"))) await deleteSourceFileLink(link.id);
    }
    return { ok: true };
  });
}
