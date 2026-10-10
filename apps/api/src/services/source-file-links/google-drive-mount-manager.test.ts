import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceFileLink } from "./types.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn((_file: string, _args: string[], options: unknown, callback?: (error: null) => void) => {
    (callback ?? options as (error: null) => void)(null);
  }),
  spawn: vi.fn(() => {
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      signalCode: string | null;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.exitCode = null;
    child.signalCode = null;
    child.stderr = new EventEmitter();
    child.kill = vi.fn(() => {
      child.exitCode = 0;
      queueMicrotask(() => child.emit("exit", 0));
    });
    return child;
  })
}));

vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: vi.fn(),
    mkdtemp: vi.fn(async (prefix: string) => `${prefix}test`),
    readdir: vi.fn(async () => []),
    readFile: vi.fn(async () => ""),
    rename: vi.fn(async () => undefined),
    rmdir: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
    writeFile: vi.fn()
  }
}));

vi.mock("node:os", () => ({
  default: { tmpdir: vi.fn(() => "/api-tmp") }
}));

vi.mock("../sources/source-access.js", () => ({
  resolveWorkspaceSourceAccess: vi.fn(async () => ({
    settings: { clientId: "client-id", clientSecret: "client-secret" },
    connection: {
      tokens: {
        accessToken: "access-token",
        refreshToken: "refresh-token",
        tokenType: "Bearer",
        expiresAt: "2026-09-14T00:00:00.000Z"
      }
    }
  }))
}));

import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { acquireGoogleDriveFolderMount, releaseGoogleDriveFolderMount, unlinkGoogleDriveFolderMount } from "./google-drive-mount-manager.js";

const link = {
  id: "link-1",
  workspaceId: "workspace-1",
  remoteItemId: "folder-1"
} as SourceFileLink;

describe("Google Drive mount manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shares one API-owned mount when acquisition is concurrent", async () => {
    const results = await Promise.all([
      acquireGoogleDriveFolderMount({ link, consumerId: "run-1", mountPoint: "/env/context/docs" }),
      acquireGoogleDriveFolderMount({ link, consumerId: "run-2", mountPoint: "/env/context/docs" })
    ]);

    expect(results).toEqual(["/env/context/docs", "/env/context/docs"]);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(vi.mocked(spawn).mock.calls[0][1]).toEqual(expect.arrayContaining(["--drive-export-formats", "url"]));
    expect(vi.mocked(spawn).mock.calls[0][1]).not.toContain("--drive-skip-gdocs");
    expect(fs.writeFile).toHaveBeenCalledWith(
      "/api-tmp/meowbert-google-drive-test/rclone.conf",
      expect.stringContaining("refresh-token"),
      { mode: 0o600 }
    );
    expect(fs.readdir).not.toHaveBeenCalled();
    await unlinkGoogleDriveFolderMount(link.id, "run-1");
    await unlinkGoogleDriveFolderMount(link.id, "run-2");
  });

  it("removes the API-owned config directory when the mount is unlinked", async () => {
    const unlinkLink = { ...link, id: "link-2" } as SourceFileLink;
    await acquireGoogleDriveFolderMount({ link: unlinkLink, consumerId: "attachment:user-1", mountPoint: "/env/context/other" });

    await unlinkGoogleDriveFolderMount(unlinkLink.id, "attachment:user-1");

    expect(fs.rm).toHaveBeenCalledWith("/api-tmp/meowbert-google-drive-test", { recursive: true, force: true });
  });

  it("keeps a mount alive when a task still references it", async () => {
    const activeLink = { ...link, id: "link-active-task" } as SourceFileLink;
    await acquireGoogleDriveFolderMount({
      link: activeLink,
      consumerId: "attachment:user-1",
      mountPoint: "/env/context/active"
    });
    await acquireGoogleDriveFolderMount({
      link: activeLink,
      consumerId: "task-1:user-1",
      mountPoint: "/env/context/active"
    });

    await expect(unlinkGoogleDriveFolderMount(activeLink.id, "attachment:user-1"))
      .rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining("running task")
      });
    expect(fs.rm).not.toHaveBeenCalledWith("/api-tmp/meowbert-google-drive-test", { recursive: true, force: true });
    await releaseGoogleDriveFolderMount(activeLink.id, "task-1:user-1");
    await unlinkGoogleDriveFolderMount(activeLink.id);
  });

  it("detaches every stacked dead mount before remounting", async () => {
    const mountPoint = "/env/context/stacked drive";
    const mountLine = "100 50 0:60 / /env/context/stacked\\040drive rw - fuse.rclone google-drive: rw";
    vi.mocked(fs.readFile).mockResolvedValueOnce(`1 0 8:1 / / rw - ext4 /dev/sda1 rw\n${mountLine}\n${mountLine}\n`);

    await acquireGoogleDriveFolderMount({ link: { ...link, id: "stacked" }, consumerId: "attachment:user", mountPoint });

    const unmounts = vi.mocked(execFile).mock.calls.filter(([file]) => file === "fusermount3");
    expect(unmounts).toHaveLength(2);
    expect(unmounts.every(([, args]) => (args as string[]).includes(mountPoint))).toBe(true);
    await unlinkGoogleDriveFolderMount("stacked", "attachment:user");
  });

  it("moves local files out of the way before mounting over them", async () => {
    vi.setSystemTime(new Date("2026-10-10T10:20:01.000Z"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(fs.rmdir).mockRejectedValueOnce(Object.assign(new Error("not empty"), { code: "ENOTEMPTY" }));

    await acquireGoogleDriveFolderMount({ link: { ...link, id: "leftovers" }, consumerId: "attachment:user", mountPoint: "/env/papers" });

    expect(fs.rename).toHaveBeenCalledWith("/env/papers", "/env/papers (unsynced 2026-10-10 10-20-01)");
    expect(vi.mocked(fs.mkdir).mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(fs.rename).mock.invocationCallOrder[0]);
    expect(vi.mocked(spawn).mock.calls.at(-1)![1]).toContain("/env/papers");
    await unlinkGoogleDriveFolderMount("leftovers", "attachment:user");
  });

  it("reports a missing FUSE helper promptly without exposing rclone output", async () => {
    const mountPoint = "/env/context/missing-fuse";
    const execImplementation = vi.mocked(execFile).getMockImplementation()!;
    vi.mocked(execFile).mockImplementation(((file: string, args: string[], options: unknown, callback?: (error: Error | null) => void) => {
      if (file === "mountpoint") {
        (callback ?? options as (error: Error | null) => void)(new Error("not mounted"));
        const child = vi.mocked(spawn).mock.results.at(-1)!.value;
        child.stderr.emit("data", Buffer.from('mount failed: fusermount3: executable file not found; access-token client-secret'));
        child.exitCode = 1;
        child.emit("exit", 1, null);
        child.emit("close", 1, null);
        return;
      }
      return execImplementation(file, args, options, callback);
    }) as typeof execFile);
    try {
      const acquisition = acquireGoogleDriveFolderMount({ link: { ...link, id: "missing-fuse" }, consumerId: "attachment:user", mountPoint });
      const assertion = expect(acquisition).rejects.toMatchObject({
        statusCode: 503,
        exposeMessage: true,
        message: expect.stringContaining("FUSE")
      });
      await vi.advanceTimersByTimeAsync(200);
      await assertion;
      await expect(acquisition).rejects.not.toThrow("access-token");
      expect(fs.rm).toHaveBeenCalledWith("/api-tmp/meowbert-google-drive-test", { recursive: true, force: true });
    } finally {
      vi.mocked(execFile).mockImplementation(execImplementation);
    }
  });
});
