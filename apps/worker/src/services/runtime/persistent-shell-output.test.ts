import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readPersistentShellOutput } from "./persistent-shell-output.js";

describe("persistent shell output revision", () => {
  let taskDir: string;
  let logPath: string;
  beforeEach(async () => {
    taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "shell-output-"));
    logPath = path.join(taskDir, "session.log");
  });
  afterEach(async () => { await fs.rm(taskDir, { recursive: true, force: true }); });

  it("keeps a stable revision when there is no new output", async () => {
    await fs.writeFile(logPath, "ready\n");
    const before = await readPersistentShellOutput({ logPath, taskDir });
    expect(before.outputVersion).not.toBeNull();
    expect(await readPersistentShellOutput({ logPath, taskDir })).toEqual(before);
  });

  it("detects raw ANSI output even when rendered output is unchanged", async () => {
    await fs.writeFile(logPath, "ready");
    const before = await readPersistentShellOutput({ logPath, taskDir });
    await fs.appendFile(logPath, "\u001b[0m");
    const after = await readPersistentShellOutput({ logPath, taskDir });
    expect(after.output).toBe(before.output);
    expect(after.outputVersion).not.toBe(before.outputVersion);
  });

  it("detects a rolling log rewritten with identical retained content", async () => {
    await fs.writeFile(logPath, "tick\ntick\n");
    await fs.utimes(logPath, 1000, 1000);
    const before = await readPersistentShellOutput({ logPath, taskDir });
    await fs.writeFile(logPath, "tick\ntick\n");
    const after = await readPersistentShellOutput({ logPath, taskDir });
    expect(after.output).toBe(before.output);
    expect(after.outputVersion).not.toBe(before.outputVersion);
  });

  it("detects the first output file after an initially empty session", async () => {
    expect((await readPersistentShellOutput({ logPath, taskDir })).outputVersion).toBeNull();
    await fs.writeFile(logPath, "started\n");
    expect((await readPersistentShellOutput({ logPath, taskDir })).outputVersion).not.toBeNull();
  });
});
