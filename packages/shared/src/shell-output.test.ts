import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveShellOutputFile } from "./persistent-shell-output.js";
import { BoundedOutputCapture, windowShellOutput } from "./shell-output.js";

describe("BoundedOutputCapture", () => {
  it("keeps everything while the output fits", () => {
    const capture = new BoundedOutputCapture(100);
    capture.push(Buffer.from("a".repeat(60)));
    capture.push("b".repeat(40));

    expect(capture.text).toBe(`${"a".repeat(60)}${"b".repeat(40)}`);
    expect(capture.totalLength).toBe(100);
  });

  it("keeps the beginning and the real end of output that does not fit", () => {
    const capture = new BoundedOutputCapture(100);
    capture.push(`start-${"x".repeat(10_000)}-end`);

    expect(capture.totalLength).toBe(10_010);
    expect(capture.text.startsWith("start-")).toBe(true);
    expect(capture.text.endsWith("-end")).toBe(true);
    expect(capture.text.length).toBeLessThan(200);
  });

  it("does not split multi-byte characters across chunks", () => {
    const capture = new BoundedOutputCapture(100);
    const bytes = Buffer.from("héllo");
    capture.push(bytes.subarray(0, 2));
    capture.push(bytes.subarray(2));

    expect(capture.text).toBe("héllo");
  });
});

describe("windowShellOutput", () => {
  const window = { head: 5, tail: 5 };

  it("returns short output untouched", () => {
    expect(windowShellOutput("0123456789", 10, window)).toBe("0123456789");
  });

  it("names where long output was saved", () => {
    const output = windowShellOutput("0123456789ABCDEF", 16, window, "$TASK_SCRATCH_DIR/shell-output/a.txt");

    expect(output).toBe("01234\n...[truncated; full output length: 16 characters; saved to $TASK_SCRATCH_DIR/shell-output/a.txt]\nBCDEF");
  });
});

describe("saveShellOutputFile", () => {
  let dir: string | null = null;

  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = null;
  });

  it("removes the oldest saved output to stay inside the budget", async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "shell-output-"));
    const target = path.join(dir, "shell-output");
    await saveShellOutputFile({ dir: target, name: "first.txt", text: "a".repeat(40), budgetBytes: 100 });
    await fs.utimes(path.join(target, "first.txt"), new Date(1_000), new Date(1_000));
    await saveShellOutputFile({ dir: target, name: "second.txt", text: "b".repeat(40), budgetBytes: 100 });
    await saveShellOutputFile({ dir: target, name: "third.txt", text: "c".repeat(40), budgetBytes: 100 });

    expect((await fs.readdir(target)).sort()).toEqual(["second.txt", "third.txt"]);
  });
});
