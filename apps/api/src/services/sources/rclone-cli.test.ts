import fsPromises from "node:fs/promises";
import { afterAll, describe, expect, it, vi } from "vitest";
const testRuntime = vi.hoisted(() => ({
  root: `/tmp/meowbert-rclone-cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
}));

vi.mock("../../lib/config.js", () => ({
  config: {
    runtime: {
      tasksRoot: `${testRuntime.root}/tasks`
    }
  }
}));

const {
  ensureRcloneBinary,
  ensureRcloneConfigFile
} = await import("./rclone-cli.js");

describe("ensureRcloneBinary", () => {
  afterAll(async () => {
    await fsPromises.rm(testRuntime.root, { recursive: true, force: true });
  });

  it("rejects rclone before checking for or executing the binary", async () => {
    await expect(ensureRcloneBinary()).rejects.toMatchObject({
      message: "The rclone source is temporarily disabled because tenant-provided backends can access API runtime paths."
    });
  });

  it("does not materialize tenant rclone configuration while disabled", async () => {
    const sourceConfig = {
      rcloneConfig: "[docs]\ntype = alias\nremote = /srv/docs",
      remoteName: "docs",
      baseDirectory: ""
    };

    await expect(ensureRcloneConfigFile(sourceConfig)).rejects.toThrow("temporarily disabled");
    await expect(fsPromises.stat(testRuntime.root)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
