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
    await expect(fs.readFile(path.join(targetDirectory.absolutePath, "report.txt"), "utf8")).resolves.toBe("hello");
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
});
