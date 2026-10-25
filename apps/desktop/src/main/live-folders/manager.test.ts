import { expect, it, vi } from "vitest";
import { LiveFolderManager } from "./manager";
import type { LocalLiveFolderConfig } from "@meowbert/shared";
const folder: LocalLiveFolderConfig = { linkId: "link", connectionId: "connection", accountLabel: "user", localRelativePath: "context/docs", config: "secret" };

it("shares one mount across concurrent runs and stops it after the last release", async () => {
  const stop = vi.fn().mockResolvedValue(undefined);
  const start = vi.fn().mockResolvedValue({ path: "/native/docs", stop });
  const manager = new LiveFolderManager("/owned", "/bundled/rclone", start);
  const signal = new AbortController().signal;
  expect(await Promise.all([manager.acquire(folder, "run-a", signal), manager.acquire(folder, "run-b", signal)])).toEqual(["/native/docs", "/native/docs"]);
  expect(start).toHaveBeenCalledOnce();
  await manager.release("run-a");
  expect(stop).not.toHaveBeenCalled();
  await manager.release("run-b");
  expect(stop).toHaveBeenCalledOnce();
  await manager.release("run-b");
  expect(stop).toHaveBeenCalledOnce();
});

it("fencing awaits a mount that is still starting and stops it", async () => {
  let finish!: (mount: { path: string; stop: () => Promise<void> }) => void;
  const start = vi.fn(() => new Promise<{ path: string; stop: () => Promise<void> }>((resolve) => { finish = resolve; }));
  const stop = vi.fn().mockResolvedValue(undefined);
  const manager = new LiveFolderManager("/owned", "/bundled/rclone", start);
  const abort = new AbortController();
  const acquire = manager.acquire(folder, "run", abort.signal);
  const rejected = expect(acquire).rejects.toThrow();
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  abort.abort();
  const release = manager.release("run");
  finish({ path: "/native", stop });
  await rejected; await release;
  expect(stop).toHaveBeenCalledOnce();
});

it("does not replace an active mount after a connection changes", async () => {
  const start = vi.fn().mockResolvedValue({ path: "/native", stop: vi.fn().mockResolvedValue(undefined) });
  const manager = new LiveFolderManager("/owned", "/bundled/rclone", start);
  await manager.acquire(folder, "run", new AbortController().signal);
  await expect(manager.acquire({ ...folder, connectionId: "other" }, "another", new AbortController().signal)).rejects.toThrow("connection changed");
  expect(start).toHaveBeenCalledOnce();
  await manager.release("run");
});
