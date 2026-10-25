import Fastify from "fastify";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("./workspace-file-location.js", () => ({ loadWorkspaceFileLocation: vi.fn() }));
import { loadWorkspaceFileLocation } from "./workspace-file-location.js";
import { installWorkspaceFileGates } from "./workspace-file-gates.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const app = Fastify();
const handler = vi.fn(async () => ({ ok: true }));
installWorkspaceFileGates(app);
const paths = ["files", "memory", "memory/refresh", "members", "invites", "sources/source/attach", "sources", "sources/source/search"];
for (const entity of ["workspaces", "projects", "environments"]) {
  for (const path of paths) app.get("/api/" + entity + "/:id/" + path, { preHandler: async (request) => { request.user = { id: "owner" } as never; } }, handler);
}
afterEach(() => { vi.clearAllMocks(); });

it("rejects file-dependent HTTP workflows before their handlers without invoking a root guard", async () => {
  vi.mocked(loadWorkspaceFileLocation).mockResolvedValue({ workspaceId, fileHost: { kind: "device", deviceId: "device" }, deviceName: "My Mac" } as never);
  for (const path of paths.slice(0, 6)) {
    const response = await app.inject("/api/workspaces/" + workspaceId + "/" + path);
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "DEVICE_WORKSPACE_FILES", fileHost: { kind: "device" } });
  }
  expect(handler).not.toHaveBeenCalled();
  for (const path of paths.slice(6)) expect((await app.inject("/api/workspaces/" + workspaceId + "/" + path)).statusCode).toBe(200);
  expect(handler).toHaveBeenCalledTimes(2);
});

it("keeps server-hosted file operations available", async () => {
  vi.mocked(loadWorkspaceFileLocation).mockResolvedValue({ workspaceId, fileHost: { kind: "server", backendId: "default" } } as never);
  expect((await app.inject("/api/workspaces/" + workspaceId + "/files")).statusCode).toBe(200);
  expect(handler).toHaveBeenCalledOnce();
});

it.each(["projects", "environments"])("gates device files and server workflows through /api/%s", async (entity) => {
  vi.mocked(loadWorkspaceFileLocation).mockResolvedValue({ workspaceId, fileHost: { kind: "device", deviceId: "device" } } as never);
  for (const suffix of ["files", "memory/refresh", "sources/source/attach"]) {
    expect((await app.inject("/api/" + entity + "/" + workspaceId + "/" + suffix)).statusCode).toBe(409);
  }
  expect(loadWorkspaceFileLocation).toHaveBeenCalledWith("owner", { projectId: workspaceId });
  expect(handler).not.toHaveBeenCalled();
  expect((await app.inject("/api/" + entity + "/" + workspaceId + "/sources")).statusCode).toBe(200);
});
