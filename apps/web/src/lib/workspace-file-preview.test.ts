// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ get: vi.fn(), files: vi.fn() }));
vi.mock("./api", () => ({ createApiClient: () => ({ get: state.get }) }));
import { fetchWorkspaceFilePreview } from "./workspace-file-preview";
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(window, "meowbertDesktop", { configurable: true, value: { workspaceFiles: state.files } });
});
afterEach(() => { delete window.meowbertDesktop; vi.unstubAllGlobals(); });
const fileUrl = "https://server.test/api/projects/11111111-1111-4111-8111-111111111111/files/download?path=photo.png";

it("previews device bytes through IPC without sending file data to the server", async () => {
  state.get.mockResolvedValue({ fileHost: { kind: "device", deviceId: "device" } });
  state.files.mockResolvedValue({ dataBase64: btoa("image data") });
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await (await fetchWorkspaceFilePreview(fileUrl, "token", new AbortController().signal)).text()).toBe("image data");
  expect(state.files).toHaveBeenCalledOnce();
  expect(fetch).not.toHaveBeenCalled();
});

it("keeps authenticated HTTP delivery for server files", async () => {
  state.get.mockResolvedValue({ fileHost: { kind: "server", backendId: "default" } });
  const fetch = vi.fn().mockResolvedValue(new Response("server data")); vi.stubGlobal("fetch", fetch);
  expect(await (await fetchWorkspaceFilePreview(fileUrl, "token", new AbortController().signal)).text()).toBe("server data");
  expect(fetch).toHaveBeenCalledWith(fileUrl, expect.objectContaining({ headers: { authorization: "Bearer token" } }));
  expect(state.files).not.toHaveBeenCalled();
});
