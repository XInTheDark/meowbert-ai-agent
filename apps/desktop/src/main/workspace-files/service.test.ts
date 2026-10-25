import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ bootstrap: vi.fn(), request: vi.fn() }));
vi.mock("../state", () => ({ readBootstrapData: state.bootstrap }));
vi.mock("../executor/device-api", () => ({ createDeviceApi: () => ({ request: state.request }) }));
import { initializeDeviceWorkspace, resolveDevicePath, verifyDeviceWorkspace } from "./roots";
import { requestDeviceWorkspaceFiles } from "./service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const taskId = "33333333-3333-4333-8333-333333333333";
let root: string;
beforeEach(async () => {
  vi.resetAllMocks();
  root = await fs.mkdtemp(path.join(os.tmpdir(), "device-workspace-"));
  await initializeDeviceWorkspace(root, workspaceId);
  state.bootstrap.mockResolvedValue({ token: "session", localExecutionSettings: {
    serverBaseUrl: "https://server.test", deviceId: "device", workspaceRoots: { [workspaceId]: root }
  } });
  state.request.mockImplementation(async (url: string) => url.startsWith("/api/workspace-files/location") ? {
    workspaceId, fileHost: { kind: "device", deviceId: "device" }, deviceName: "My computer",
    projectId, taskRootPath: null, memoryEnabled: true
  } : { ok: true });
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it.each(["projects", "environments"])("uploads, browses, previews and deletes device task inputs through /api/%s", async (entity) => {
  const inputPath = ".meowbert/task-runs/" + taskId + "/inputs";
  const base = "/api/" + entity + "/" + projectId + "/files";
  await requestDeviceWorkspaceFiles({ method: "POST", path: base + "/upload?path=" + inputPath,
    file: { name: "input.txt", dataBase64: Buffer.from("device input").toString("base64"), type: "text/plain" } });
  expect(state.request).toHaveBeenCalledWith("/api/projects/" + projectId + "/device-inputs", "POST", expect.objectContaining({
    relativePath: inputPath + "/input.txt", sizeBytes: 12, sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
  }));
  expect(JSON.stringify(state.request.mock.calls)).not.toContain("device input");
  expect(await requestDeviceWorkspaceFiles({ method: "GET", path: base + "?path=" + inputPath })).toMatchObject({
    items: [expect.objectContaining({ name: "input.txt", kind: "file" })]
  });
  expect(await requestDeviceWorkspaceFiles({ method: "GET", path: base + "/content?path=" + inputPath + "/input.txt" })).toMatchObject({ text: "device input" });
  expect(await requestDeviceWorkspaceFiles({ method: "GET", path: base + "/download?path=" + inputPath + "/input.txt" })).toEqual({ dataBase64: Buffer.from("device input").toString("base64") });
  expect(await requestDeviceWorkspaceFiles({ method: "POST", path: base + "/delete", body: { paths: [inputPath + "/input.txt"] } })).toMatchObject({
    deletedCount: 1, deletedPaths: [inputPath + "/input.txt"]
  });
  await expect(fs.stat(path.join(root, "projects", projectId, inputPath, "input.txt"))).rejects.toMatchObject({ code: "ENOENT" });
});

it("keeps Project Context and memory local", async () => {
  await requestDeviceWorkspaceFiles({ method: "POST", path: "/api/projects/" + projectId + "/files/text?path=context",
    body: { name: "notes.md", content: "Project context" } });
  expect(await fs.readFile(path.join(root, "projects", projectId, "context/notes.md"), "utf8")).toBe("Project context");
  expect(await requestDeviceWorkspaceFiles({ method: "GET", path: "/api/workspaces/" + workspaceId + "/memory?projectId=" + projectId })).toMatchObject({
    enabled: true, suggestedActionsEnabled: false, workspace: { path: expect.stringContaining(root) }, project: { path: expect.stringContaining(projectId) }
  });
});

it("requires the workspace marker and rejects traversal and escaping symlinks", async () => {
  await expect(verifyDeviceWorkspace(root, projectId)).rejects.toThrow("different workspace");
  await expect(resolveDevicePath(root, "../outside")).rejects.toThrow("escapes");
  await fs.symlink(os.tmpdir(), path.join(root, "outside"));
  await expect(resolveDevicePath(root, "outside/input.txt")).rejects.toThrow("symlink");
  await expect(requestDeviceWorkspaceFiles({ method: "POST", path: "/api/workspaces/" + workspaceId + "/files/delete",
    body: { paths: [""] } })).rejects.toThrow("root");
});

it("refuses files owned by a different device", async () => {
  state.bootstrap.mockResolvedValue({ token: "session", localExecutionSettings: { serverBaseUrl: "https://server.test", deviceId: "other" } });
  await expect(requestDeviceWorkspaceFiles({ method: "GET", path: "/api/projects/" + projectId + "/files" })).rejects.toThrow("My computer");
});
