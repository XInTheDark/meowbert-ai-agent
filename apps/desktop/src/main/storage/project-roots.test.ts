import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { resolveVerifiedStoragePath } from "./roots";

let root: string;
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "local-project-root-"))); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

it("creates a named empty project directory omitted by a sync client, without replacing existing files", async () => {
  const relative = "storage/workspaces/workspace/environments/project/root";
  const expected = path.join(root, relative);
  await expect(resolveVerifiedStoragePath(root, relative)).rejects.toMatchObject({ code: "ENOENT" });
  await expect(resolveVerifiedStoragePath(root, relative, { createDirectory: true })).resolves.toBe(expected);
  await fs.writeFile(path.join(expected, "existing.txt"), "keep");
  await resolveVerifiedStoragePath(root, relative, { createDirectory: true });
  expect(await fs.readFile(path.join(expected, "existing.txt"), "utf8")).toBe("keep");
});

it("never creates an unavailable selected storage mount", async () => {
  const missing = path.join(root, "missing-mount");
  await expect(resolveVerifiedStoragePath(missing, "project/root", { createDirectory: true }))
    .rejects.toMatchObject({ code: "ENOENT" });
  await expect(fs.stat(missing)).rejects.toMatchObject({ code: "ENOENT" });
});

it("checks existing symlink ancestors before creating anything outside the storage mount", async () => {
  const mount = path.join(root, "mount");
  const outside = path.join(root, "outside");
  await fs.mkdir(mount); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(mount, "project"), process.platform === "win32" ? "junction" : "dir");
  await expect(resolveVerifiedStoragePath(mount, "project/root", { createDirectory: true })).rejects.toThrow("escapes");
  await expect(fs.stat(path.join(outside, "root"))).rejects.toMatchObject({ code: "ENOENT" });
});

it.each(["../outside", "/outside", "C:\\outside"])("rejects unsafe directory paths %s before creating them", async (relative) => {
  await expect(resolveVerifiedStoragePath(root, relative, { createDirectory: true })).rejects.toThrow("escapes");
});
