import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { resolveSafeOutputPath, writeSafeOutputFile } from "./persistent-shell-output.js";
import { persistentShellTestUtils } from "./persistent-shell-sessions.js";

const execFile = promisify(execFileCallback);

describe("persistent shell sessions", () => {
  it("supports interactive processes and reconnecting clients in the bundled supervisor", async () => {
    await execFile("python3", ["-m", "unittest", "discover", "-s",
      path.resolve(process.cwd(), "../sandbox-runtime/scripts/persistent_shell"), "-p", "test_*.py"],
      { timeout: 60_000, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
  }, 65_000);

  it("provides the normal shell environment for a project-root session", () => {
    expect(persistentShellTestUtils.buildPersistentShellEnvironment({
      taskDir: "/runtime/env/.meowbert/task-runs/task-1",
      envRoot: "/runtime/env",
      workspaceRoot: "/runtime/workspace",
      workingDir: "/runtime/env",
      envOverrides: { GH_TOKEN: "token" }
    })).toEqual({
      TASK_DIR: "/runtime/env/.meowbert/task-runs/task-1",
      ENV_ROOT: "/runtime/env",
      TASK_INPUT_DIR: "/runtime/env/.meowbert/task-runs/task-1/inputs",
      PWD: "/runtime/env",
      HOME: "/runtime/env",
      TERM: "xterm-256color",
      WORKSPACE_ROOT: "/runtime/workspace",
      MEOWBERT_WORKSPACE_ROOT: "/runtime/workspace",
      MEOWBERT_ENV_ROOT: "/runtime/env",
      GH_TOKEN: "token"
    });
  });

  it("rejects output paths that traverse a symlink outside the task directory", async () => {
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-task-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-outside-"));
    await fs.symlink(outsideDir, path.join(taskDir, "linked"), "dir");

    await expect(
      resolveSafeOutputPath(taskDir, "linked/output.txt")
    ).rejects.toThrow("save_output_path must stay inside the current task directory.");
    await expect(
      resolveSafeOutputPath(taskDir, "nested/output.txt")
    ).resolves.toBe(path.join(await fs.realpath(taskDir), "nested", "output.txt"));
  });

  it("replaces an output symlink without writing through it", async () => {
    const taskDir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-task-"));
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-outside-"));
    const outsideFile = path.join(outsideDir, "output.txt");
    const target = path.join(taskDir, "output.txt");
    await fs.writeFile(outsideFile, "outside", "utf8");
    await fs.symlink(outsideFile, target);

    await writeSafeOutputFile(target, "inside");

    await expect(fs.readFile(outsideFile, "utf8")).resolves.toBe("outside");
    await expect(fs.readFile(target, "utf8")).resolves.toBe("inside");
  });
});
