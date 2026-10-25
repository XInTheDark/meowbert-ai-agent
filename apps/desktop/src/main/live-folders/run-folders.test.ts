import { afterEach, expect, it, vi } from "vitest";
import type { RunBootstrap } from "@meowbert/run-executor/agent/ports/run-bootstrap";
import type { DesktopLocalExecutorOptions } from "../executor/local-executor";
import { LiveFolderManager } from "./manager";
import { prepareRunLiveFolders } from "./run-folders";

const folder = { linkId: "link", connectionId: "a".repeat(64), accountLabel: "user", localRelativePath: "context/docs" };
const bootstrap = { liveSyncFiles: [{ id: "link", provider: "google-drive", linkKind: "folder",
  taskRelativePath: "context/docs", localRelativePath: "context/docs" }] } as RunBootstrap;
const nativePlatform = process.platform;
afterEach(() => { Object.defineProperty(process, "platform", { value: nativePlatform }); vi.restoreAllMocks(); });

function fixture(consent = true) {
  const calls: string[] = [];
  const stop = vi.fn().mockResolvedValue(undefined);
  const start = vi.fn(async () => { calls.push("mount"); return { path: "/owned/live/docs", stop }; });
  const manager = new LiveFolderManager("/owned", "/bundled/rclone", start);
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    calls.push(init?.method === "POST" ? "config" : "metadata");
    return Response.json(init?.method === "POST" ? { ...folder, config: "credential" } : { folders: [folder] });
  });
  const options = { apiBaseUrl: "https://server.test", liveDriveEnabled: true, liveFolders: manager, fetch,
    onLiveFolderConsent: async () => { calls.push("consent"); return consent; } } as unknown as DesktopLocalExecutorOptions;
  return { options, calls, manager, stop, start, fetch };
}

it("asks consent before fetching credentials, remaps the run path, and releases its mount", async () => {
  Object.defineProperty(process, "platform", { value: "darwin" });
  const test = fixture();
  const result = await prepareRunLiveFolders({ options: test.options, bootstrap, runId: "run", token: "lease",
    consumer: "consumer", host: true, signal: new AbortController().signal });
  expect(test.calls).toEqual(["metadata", "consent", "config", "mount"]);
  expect(result[0]).toMatchObject({ taskRelativePath: "/owned/live/docs", localRelativePath: "context/docs" });
  expect(test.fetch).toHaveBeenLastCalledWith(expect.stringContaining("/live-folders/link/rclone-config"), expect.objectContaining({
    headers: expect.objectContaining({ authorization: "Bearer lease" }),
    body: JSON.stringify({ connectionId: folder.connectionId, consent: true })
  }));
  await test.manager.release("consumer");
  expect(test.stop).toHaveBeenCalledOnce();
});

it("returns a storage wait without credentials or a mount when consent is declined", async () => {
  Object.defineProperty(process, "platform", { value: "darwin" });
  const test = fixture(false);
  await expect(prepareRunLiveFolders({ options: test.options, bootstrap, runId: "run", token: "lease",
    consumer: "consumer", host: true, signal: new AbortController().signal })).rejects.toThrow("consent");
  expect(test.calls).toEqual(["metadata", "consent"]);
  expect(test.start).not.toHaveBeenCalled();
});

it.each([{ platform: "win32", host: true }, { platform: "darwin", host: false }] as const)("does not request credentials on unsupported $platform host=$host", async ({ platform, host }) => {
  Object.defineProperty(process, "platform", { value: platform });
  const test = fixture();
  await expect(prepareRunLiveFolders({ options: test.options, bootstrap, runId: "run", token: "lease",
    consumer: "consumer", host, signal: new AbortController().signal })).rejects.toThrow("macOS host mode");
  expect(test.fetch).not.toHaveBeenCalled();
});
