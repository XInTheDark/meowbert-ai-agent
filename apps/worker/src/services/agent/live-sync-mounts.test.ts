import { describe, expect, it, vi } from "vitest";
vi.mock("node:child_process", () => ({ execFile: vi.fn((_file, _args, _options, callback) => callback(null)) }));
import { execFile } from "node:child_process";
import { prepareTaskSourceMounts, verifyTaskSourceMounts } from "./live-sync-mounts.js";

const result = { command: "", stdout: "", stderr: "", exitCode: 0, timedOut: false, aborted: false };

describe("task source mount visibility", () => {
  it("preserves read-only task scope on explicit source binds", async () => {
    await expect(prepareTaskSourceMounts(["/task/inputs/Notes"], true)).resolves.toEqual([
      { path: "/task/inputs/Notes", readOnly: true }
    ]);
    expect(execFile).toHaveBeenCalledWith("mountpoint", ["-q", "--", "/task/inputs/Notes"], expect.any(Object), expect.any(Function));
  });

  it("stops before sandbox creation if API mounts never reach the worker", async () => {
    vi.mocked(execFile).mockImplementationOnce(((_file, _args, _options, callback) => callback(new Error("not mounted"))) as typeof execFile);
    await expect(prepareTaskSourceMounts(["/task/inputs/Notes"], false)).rejects.toThrow("unavailable to the worker");
  });

  it("rejects an attachment invisible inside the actual sandbox", async () => {
    const sandbox = { executeShellCommand: vi.fn(async () => ({ ...result, exitCode: 1 })) };
    await expect(verifyTaskSourceMounts(sandbox, ["/task/inputs/Notes"], "/task"))
      .rejects.toThrow("unavailable in the task sandbox (inputs/Notes)");
  });

  it("checks mounts without listing or reading remote contents and quotes folder names", async () => {
    const sandbox = { executeShellCommand: vi.fn(async () => result) };
    await verifyTaskSourceMounts(sandbox, ["/task/inputs/Jerry's $(notes)"], "/task");
    expect(sandbox.executeShellCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "for folder in '/task/inputs/Jerry'\\''s $(notes)'; do mountpoint -q -- \"$folder\" || exit 1; done"
    }));
  });

  it("skips the probe when no live Drive folder is attached", async () => {
    const sandbox = { executeShellCommand: vi.fn(async () => result) };
    await verifyTaskSourceMounts(sandbox, [], "/task");
    expect(sandbox.executeShellCommand).not.toHaveBeenCalled();
  });
});
