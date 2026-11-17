import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { saveUploadedFile, UploadTooLargeError } from "./save-uploaded-file.js";

const tempRoots: string[] = [];

async function createTargetDirectory(): Promise<{ absolutePath: string; rootRealPath: string }> {
  const rootPath = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-save-upload-")));
  tempRoots.push(rootPath);
  return { absolutePath: rootPath, rootRealPath: rootPath };
}

function uploadStream(content: string, truncated: boolean): Readable & { truncated: boolean } {
  return Object.assign(Readable.from([Buffer.from(content)]), { truncated });
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootPath) => fs.rm(rootPath, { recursive: true, force: true })));
});

describe("saveUploadedFile", () => {
  it("saves a complete upload", async () => {
    const targetDirectory = await createTargetDirectory();

    const saved = await saveUploadedFile({
      targetDirectory,
      filename: "report.txt",
      file: uploadStream("hello", false),
      limitBytes: 100
    });

    expect(saved.file).toMatchObject({ name: "report.txt", relativePath: "report.txt", sizeBytes: 5 });
    expect(saved.file.sha256).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(saved.file.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    expect(saved.file.modifiedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
    await expect(fs.readFile(path.join(targetDirectory.absolutePath, "report.txt"), "utf8")).resolves.toBe("hello");
  });

  it("keeps every copy when files with the same name upload in parallel", async () => {
    const targetDirectory = await createTargetDirectory();

    const saved = await Promise.all(["first", "second", "third"].map((content) => saveUploadedFile({
      targetDirectory,
      filename: "image.jpg",
      file: uploadStream(content, false),
      limitBytes: 100
    })));

    expect(saved.map((upload) => upload.file.name).sort()).toEqual(["image (1).jpg", "image (2).jpg", "image.jpg"]);
    const contents = await Promise.all(saved.map((upload) => fs.readFile(upload.absolutePath, "utf8")));
    expect(contents.sort()).toEqual(["first", "second", "third"]);
  });

  it("rejects an upload cut off at the size limit and leaves no partial file", async () => {
    const targetDirectory = await createTargetDirectory();

    await expect(saveUploadedFile({
      targetDirectory,
      filename: "big.bin",
      file: uploadStream("partial", true),
      limitBytes: 100 * 1024 * 1024
    })).rejects.toBeInstanceOf(UploadTooLargeError);

    await expect(fs.readdir(targetDirectory.absolutePath)).resolves.toEqual([]);
  });

  it("enforces the byte limit even when the source is not marked truncated", async () => {
    const targetDirectory = await createTargetDirectory();
    await expect(saveUploadedFile({ targetDirectory, filename: "too-large.bin", file: uploadStream("oversized", false), limitBytes: 3 }))
      .rejects.toBeInstanceOf(UploadTooLargeError);
    expect(await fs.readdir(targetDirectory.absolutePath)).toEqual([]);
  });

  it("preserves a source stream failure and removes its partial upload", async () => {
    const targetDirectory = await createTargetDirectory();
    const file = Readable.from((async function* () {
      yield Buffer.from("partial");
      throw new Error("source disconnected");
    })());
    await expect(saveUploadedFile({ targetDirectory, filename: "partial.bin", file, limitBytes: 100 }))
      .rejects.toThrow("source disconnected");
    expect(await fs.readdir(targetDirectory.absolutePath)).toEqual([]);
  });

  it("treats an existing outside symlink as a collision and never overwrites it", async () => {
    const targetDirectory = await createTargetDirectory();
    const external = await createTargetDirectory();
    const sentinel = path.join(external.absolutePath, "sentinel");
    await fs.writeFile(sentinel, "untouched");
    await fs.symlink(sentinel, path.join(targetDirectory.absolutePath, "report.txt"));
    const saved = await saveUploadedFile({ targetDirectory, filename: "report.txt", file: uploadStream("new", false), limitBytes: 100 });
    expect(saved.file.name).toBe("report (1).txt");
    expect(await fs.readFile(sentinel, "utf8")).toBe("untouched");
  });
});
