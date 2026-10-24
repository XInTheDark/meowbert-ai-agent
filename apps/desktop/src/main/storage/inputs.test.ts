import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { StorageNotReadyError, waitForRunInputs } from "./inputs";

let root: string;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-inputs-"))); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const input = () => ({ taskDir: root, signal: new AbortController().signal, retryMs: 5, timeoutMs: 100,
  inputs: [{ relativePath: "input.txt", sizeBytes: 5, sha256: hash("hello") }] });

it("waits for a named input and verifies its bytes instead of relying on listings", async () => {
  const pending = waitForRunInputs(input());
  await fs.writeFile(path.join(root, "input.txt"), "wrong");
  await new Promise((resolve) => setTimeout(resolve, 10));
  await fs.writeFile(path.join(root, "input.txt"), "hello");
  await pending;
});

it.each([null, "wrong", "shorter"])("returns storage wait for a missing or mismatched input %s", async (content) => {
  if (content !== null) await fs.writeFile(path.join(root, "input.txt"), content);
  await expect(waitForRunInputs({ ...input(), timeoutMs: 10 })).rejects.toBeInstanceOf(StorageNotReadyError);
});

it("rejects path escapes before opening a file and honors cancellation", async () => {
  await expect(waitForRunInputs({ ...input(), inputs: [{ relativePath: "../secret", sizeBytes: 0, sha256: hash("") }] })).rejects.toThrow(/escapes/);
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await expect(waitForRunInputs({ ...input(), signal: controller.signal })).rejects.toThrow("cancelled");
});
