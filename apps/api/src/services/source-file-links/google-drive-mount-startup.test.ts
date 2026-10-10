import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFile: vi.fn((_file, _args, _options, callback) => callback(new Error("not mounted")))
}));

import { execFile } from "node:child_process";
import { waitForGoogleDriveMount } from "./google-drive-mount-startup.js";

function createChild(): ChildProcess {
  return Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    stderr: new EventEmitter()
  }) as unknown as ChildProcess;
}

describe("Google Drive mount startup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("handles a failed spawn without an unhandled error or readiness timeout", async () => {
    const child = createChild();
    const ready = waitForGoogleDriveMount(child, "/mount");
    const assertion = expect(ready).rejects.toMatchObject({
      statusCode: 503,
      exposeMessage: true,
      message: expect.stringContaining("rclone installation")
    });
    child.emit("error", Object.assign(new Error("spawn rclone ENOENT"), { code: "ENOENT" }));
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("stops waiting when the process is killed by a signal", async () => {
    const child = createChild();
    child.signalCode = "SIGKILL";
    const assertion = expect(waitForGoogleDriveMount(child, "/mount")).rejects.toMatchObject({
      statusCode: 503,
      message: expect.stringContaining("could not mount")
    });
    await vi.advanceTimersByTimeAsync(600);
    await assertion;
  });

  it("times out with a retryable error and bounds individual mount probes", async () => {
    const ready = waitForGoogleDriveMount(createChild(), "/mount");
    const assertion = expect(ready).rejects.toMatchObject({
      statusCode: 503,
      exposeMessage: true,
      retryable: true,
      message: expect.stringContaining("too long")
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(execFile).toHaveBeenCalledWith("mountpoint", ["-q", "/mount"], {
      timeout: 1_000,
      killSignal: "SIGKILL"
    }, expect.any(Function));
  });

  it("returns a safe authorization diagnosis without exposing provider output", async () => {
    const child = createChild();
    const ready = waitForGoogleDriveMount(child, "/mount");
    const assertion = expect(ready).rejects.toThrow(
      "Google Drive could not authorize the live folder. Reconnect the workspace Google Drive account and try again."
    );
    child.stderr!.emit("data", Buffer.from("invalid_grant secret-access-token"));
    child.exitCode = 1;
    child.emit("close", 1, null);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("fails without retrying when the Drive folder is gone", async () => {
    const child = createChild();
    const ready = waitForGoogleDriveMount(child, "/mount");
    const assertion = expect(ready).rejects.toMatchObject({
      statusCode: 409,
      retryable: false,
      message: expect.stringContaining("no longer exists")
    });
    child.stderr!.emit("data", Buffer.from("Fatal error: couldn't find root directory ID: googleapi: Error 404: File not found: folder-1., notFound"));
    child.exitCode = 1;
    child.emit("close", 1, null);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("logs the rclone error with credentials redacted", async () => {
    const child = createChild();
    const ready = waitForGoogleDriveMount(child, "/mount");
    const assertion = expect(ready).rejects.toThrow("server log");
    child.stderr!.emit("data", Buffer.from('Fatal error: drive failed {"access_token":"ya29.a0Secret","refresh_token":"1//0gRefreshSecretValue123456"} GOCSPX-clientSecret'));
    child.exitCode = 1;
    child.emit("close", 1, null);
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).toContain("Fatal error: drive failed");
    expect(logged).not.toMatch(/a0Secret|RefreshSecret|clientSecret/);
  });
});
