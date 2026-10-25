import Fastify from "fastify";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../services/workspaces/workspace-file-location.js", () => ({ loadWorkspaceFileLocation: vi.fn() }));
vi.mock("../services/source-file-links/store.js", () => ({ deleteSourceFileLink: vi.fn(), listSourceFileLinksUnderEnvironmentPaths: vi.fn() }));
import { loadWorkspaceFileLocation } from "../services/workspaces/workspace-file-location.js";
import { deleteSourceFileLink, listSourceFileLinksUnderEnvironmentPaths } from "../services/source-file-links/store.js";
import { registerDeviceLiveFolderRoutes } from "./device-live-folders.js";
const projectId = "11111111-1111-4111-8111-111111111111";
const base = "/api/projects/" + projectId + "/live-drive-folders";
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(loadWorkspaceFileLocation).mockResolvedValue({ workspaceId: "workspace", fileHost: { kind: "device", deviceId: "device" } } as never);
  vi.mocked(listSourceFileLinksUnderEnvironmentPaths).mockResolvedValue([
    { id: "mine", workspaceId: "workspace", provider: "google-drive", linkKind: "folder", localRelativePath: "context/references/Drive", remoteName: "Drive" },
    { id: "other", workspaceId: "another-workspace", provider: "google-drive", linkKind: "folder", localRelativePath: "context/references/Other" }
  ] as never);
});

async function app() {
  const instance = Fastify();
  instance.decorate("authenticate", async (request) => { request.user = { id: "owner" } as never; });
  registerDeviceLiveFolderRoutes(instance);
  return instance;
}

it("lists authorized folder metadata without credentials and unlinks a selected parent only", async () => {
  const server = await app();
  try {
    const response = await server.inject(base);
    expect(response.statusCode).toBe(200);
    expect(response.json().folders).toEqual([expect.objectContaining({ id: "mine", localRelativePath: "context/references/Drive" })]);
    expect(loadWorkspaceFileLocation).toHaveBeenCalledWith("owner", { projectId });
    const removed = await server.inject({ method: "POST", url: base + "/unlink", payload: { paths: ["context/references"] } });
    expect(removed.statusCode).toBe(200);
    expect(deleteSourceFileLink).toHaveBeenCalledExactlyOnceWith("mine");
  } finally { await server.close(); }
});

it("rejects escaped paths and propagates failed workspace authorization without deleting links", async () => {
  const server = await app();
  try {
    expect((await server.inject({ method: "POST", url: base + "/unlink", payload: { paths: ["../context"] } })).statusCode).toBe(400);
    vi.mocked(loadWorkspaceFileLocation).mockRejectedValueOnce(Object.assign(new Error("not found"), { statusCode: 404 }));
    expect((await server.inject(base)).statusCode).toBe(404);
    expect(deleteSourceFileLink).not.toHaveBeenCalled();
  } finally { await server.close(); }
});
