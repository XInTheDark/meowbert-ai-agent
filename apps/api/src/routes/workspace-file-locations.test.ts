import Fastify from "fastify";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../services/workspaces/workspace-file-location.js", () => ({ loadWorkspaceFileLocation: vi.fn() }));
vi.mock("../services/devices/device-service.js", () => ({ listDevices: vi.fn() }));
vi.mock("../services/files/task-upload-manifest.js", () => ({ recordTaskUpload: vi.fn(), removeTaskInputUploads: vi.fn() }));
import { loadWorkspaceFileLocation } from "../services/workspaces/workspace-file-location.js";
import { listDevices } from "../services/devices/device-service.js";
import { removeTaskInputUploads } from "../services/files/task-upload-manifest.js";
import { workspaceFileLocationRoutes } from "./workspace-file-locations.js";
const projectId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
const body = { deviceId, paths: [".meowbert/task-runs/task/inputs/a.txt"] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadWorkspaceFileLocation).mockResolvedValue({ fileHost: { kind: "device", deviceId } } as never);
  vi.mocked(listDevices).mockResolvedValue([{ id: deviceId }] as never);
});
async function request(payload = body) {
  const app = Fastify();
  app.decorate("authenticate", async (req: any) => { req.user = { id: "owner" }; });
  await app.register(workspaceFileLocationRoutes);
  try { return await app.inject({ method: "POST", url: "/api/projects/" + projectId + "/device-inputs/delete", payload }); }
  finally { await app.close(); }
}

it("clears selected input metadata through the same authorized project/device scope as uploads", async () => {
  expect((await request()).statusCode).toBe(200);
  expect(loadWorkspaceFileLocation).toHaveBeenCalledExactlyOnceWith("owner", { projectId });
  expect(removeTaskInputUploads).toHaveBeenCalledExactlyOnceWith(projectId, body.paths);
});

it.each(["different-device", "not-owner", "server-files"])("refuses metadata deletion for %s", async (variant) => {
  if (variant === "different-device") vi.mocked(loadWorkspaceFileLocation).mockResolvedValue({ fileHost: { kind: "device", deviceId: "foreign" } } as never);
  if (variant === "not-owner") vi.mocked(listDevices).mockResolvedValue([]);
  if (variant === "server-files") vi.mocked(loadWorkspaceFileLocation).mockResolvedValue({ fileHost: { kind: "server", backendId: "backend" } } as never);
  expect((await request()).statusCode).toBe(409);
  expect(removeTaskInputUploads).not.toHaveBeenCalled();
});
