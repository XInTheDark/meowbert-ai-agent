import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const race = vi.hoisted(() => ({ beforeSpawn: null as (() => void) | null, afterOpen: "", name: "" }));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawn: (command: string, args: string[], options: object) => {
    race.beforeSpawn?.();
    if (race.afterOpen) {
      const hook = `
import os
original_open = os.open
race_done = False
def racing_open(name, flags, *args, **kwargs):
    global race_done
    fd = original_open(name, flags, *args, **kwargs)
    if not race_done and name == ${JSON.stringify(race.name)}:
        race_done = True
${race.afterOpen.split("\n").map((line) => `        ${line}`).join("\n")}
    return fd
os.open = racing_open
`;
      args = [...args];
      args[2] = hook + args[2];
    }
    return actual.spawn(command, args, options);
  } };
});

import { readFilePreview } from "./file-preview.js";
import { saveUploadedFile } from "./save-uploaded-file.js";

const directories: string[] = [];
beforeEach(() => { race.beforeSpawn = null; race.afterOpen = ""; race.name = ""; });
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const dir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "storage-file-race-")));
  directories.push(dir);
  const root = path.join(dir, "root");
  const parent = path.join(root, "parent");
  const outside = path.join(dir, "outside");
  await fsp.mkdir(parent, { recursive: true });
  await fsp.mkdir(outside);
  await fsp.writeFile(path.join(parent, "report.txt"), "inside");
  await fsp.writeFile(path.join(outside, "report.txt"), "outside sentinel");
  return { dir, root, parent, outside };
}

function upload(root: string, parent: string, filename = "new.txt", truncated = false) {
  return saveUploadedFile({ targetDirectory: { rootRealPath: root, absolutePath: parent }, filename,
    file: Object.assign(Readable.from(["replacement"]), { truncated }), limitBytes: 100 });
}

describe("descriptor-confined file operations", () => {
  it.each(["preview", "upload"])("rejects an ancestor swap before %s opens its root", async (operation) => {
    const { dir, root, parent, outside } = await fixture();
    await fsp.mkdir(path.join(outside, "parent"));
    await fsp.writeFile(path.join(outside, "parent", "report.txt"), "outside nested sentinel");
    race.beforeSpawn = () => {
      fs.renameSync(root, path.join(dir, "retired"));
      fs.symlinkSync(outside, root);
    };
    await expect(operation === "preview" ? readFilePreview(root, "parent/report.txt") : upload(root, parent)).rejects.toThrow();
    expect(await fsp.readFile(path.join(outside, "report.txt"), "utf8")).toBe("outside sentinel");
    expect(await fsp.readdir(path.join(outside, "parent"))).toEqual(["report.txt"]);
    expect(await fsp.readFile(path.join(outside, "parent", "report.txt"), "utf8")).toBe("outside nested sentinel");
  });

  it("keeps a preview on its original ancestor descriptor after a directory swap", async () => {
    const { root, parent, outside } = await fixture();
    race.name = "parent";
    race.afterOpen = `os.rename(${JSON.stringify(parent)}, ${JSON.stringify(`${parent}-retired`)})\nos.symlink(${JSON.stringify(outside)}, ${JSON.stringify(parent)})`;
    expect(await readFilePreview(root, "parent/report.txt")).toMatchObject({ text: "inside", sizeBytes: 6 });
  });

  it("keeps a preview on its opened inode after the filename is replaced", async () => {
    const { root, parent, outside } = await fixture();
    race.name = "report.txt";
    race.afterOpen = `os.unlink(${JSON.stringify(path.join(parent, "report.txt"))})\nos.symlink(${JSON.stringify(path.join(outside, "report.txt"))}, ${JSON.stringify(path.join(parent, "report.txt"))})`;
    expect(await readFilePreview(root, "parent/report.txt")).toMatchObject({ text: "inside" });
  });

  it.each([false, true])("keeps upload writes and cleanup on the pinned parent (truncated=%s)", async (truncated) => {
    const { root, parent, outside } = await fixture();
    race.name = "parent";
    race.afterOpen = `os.rename(${JSON.stringify(parent)}, ${JSON.stringify(`${parent}-retired`)})\nos.symlink(${JSON.stringify(outside)}, ${JSON.stringify(parent)})`;
    if (truncated) await expect(upload(root, parent, "new.txt", true)).rejects.toThrow("upload limit");
    else await expect(upload(root, parent)).resolves.toMatchObject({ file: { sizeBytes: 11 } });
    expect(await fsp.readdir(outside)).toEqual(["report.txt"]);
    expect(await fsp.readFile(path.join(outside, "report.txt"), "utf8")).toBe("outside sentinel");
    if (truncated) expect(await fsp.readdir(`${parent}-retired`)).toEqual(["report.txt"]);
    else expect(await fsp.readFile(path.join(`${parent}-retired`, "new.txt"), "utf8")).toBe("replacement");
  });

  it("never follows a symlink replacing the exclusively created upload", async () => {
    const { root, parent, outside } = await fixture();
    race.name = "new.txt";
    race.afterOpen = `os.unlink(name, dir_fd=kwargs['dir_fd'])\nos.symlink(${JSON.stringify(path.join(outside, "report.txt"))}, name, dir_fd=kwargs['dir_fd'])`;
    await expect(upload(root, parent)).rejects.toThrow("destination changed");
    expect(await fsp.readFile(path.join(outside, "report.txt"), "utf8")).toBe("outside sentinel");
  });

  it("rejects already-swapped ancestors and escaped preview symlinks", async () => {
    const { root, parent, outside } = await fixture();
    await fsp.rename(parent, `${parent}-retired`);
    await fsp.symlink(outside, parent);
    await expect(upload(root, parent)).rejects.toThrow();
    await expect(readFilePreview(root, "parent/report.txt")).rejects.toThrow("escapes");
  });
});

describe("file preview controls", () => {
  it("preserves in-root links, configured root aliases, the size cap and binary detection", async () => {
    const { dir, root, parent } = await fixture();
    await fsp.symlink(root, path.join(dir, "alias"));
    await fsp.symlink("parent/report.txt", path.join(root, "link.txt"));
    expect(await readFilePreview(path.join(dir, "alias"), "link.txt")).toMatchObject({ relativePath: "parent/report.txt", text: "inside" });
    await fsp.writeFile(path.join(parent, "large"), "x".repeat(300_001));
    const preview = await readFilePreview(root, "parent/large");
    expect(preview).toMatchObject({ sizeBytes: 300_001, truncated: true });
    expect(preview.text).toHaveLength(300_000);
    await fsp.writeFile(path.join(parent, "binary"), Buffer.from([1, 0, 2]));
    expect(await readFilePreview(root, "parent/binary")).toMatchObject({ encoding: "binary", text: null });
    await expect(readFilePreview(root, "parent")).rejects.toThrow("File not found");
  });
});
