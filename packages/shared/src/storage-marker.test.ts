import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readStorageMarker,
  verifyStorageRoot,
  writeStorageMarker
} from "./storage-marker.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("storage marker", () => {
  it("writes an identity marker once and verifies named-file write access", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "meowbert-storage-"));
    temporaryRoots.push(root);
    const marker = { version: 1 as const, backendId: "local-default", installId: "install-1" };
    await writeStorageMarker(root, marker);
    await writeStorageMarker(root, marker);

    expect(await readStorageMarker(root)).toEqual(marker);
    expect(await verifyStorageRoot({ root, backendId: "local-default", deviceId: "device-1" })).toMatchObject({ ok: true, marker });
    expect(await readFile(path.join(root, ".meowbert-storage.json"), "utf8")).toContain("local-default");
  });

  it("rejects a marker for another backend", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "meowbert-storage-"));
    temporaryRoots.push(root);
    await writeStorageMarker(root, { version: 1, backendId: "one", installId: "install-1" });
    expect(await verifyStorageRoot({ root, backendId: "two", deviceId: "device-1" })).toMatchObject({
      ok: false,
      reason: "wrong_backend"
    });
  });
});
