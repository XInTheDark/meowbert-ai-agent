import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DockerSandboxHandle } from "@meowbert/shared/docker-sandbox";

import { ensureTaskWorkspace, executeShellCommand } from "./shell.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(async (root) => {
    await fs.rm(root, { recursive: true, force: true });
  }));
});

describe("executeShellCommand", () => {
  it("delegates shell execution to the sandbox handle with explicit runtime env", async () => {
    const executeInSandbox = vi.fn(async () => ({
      command: "echo hi",
      stdout: "hi\n",
      stderr: "",
      exitCode: 0,
      timedOut: false,
      aborted: false
    }));
    const sandbox = {
      executeShellCommand: executeInSandbox
    } as unknown as DockerSandboxHandle;

    const result = await executeShellCommand({
      sandbox,
      shell: "/bin/bash",
      command: "echo hi",
      taskDir: "/tmp/env/.meowbert/task-runs/task-1",
      envRoot: "/tmp/env",
      timeoutMs: 60_000,
      maxOutputKb: 64,
      envOverrides: {
        GITHUB_TOKEN: "secret"
      }
    });

    expect(result.stdout).toBe("hi\n");
    expect(executeInSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        shell: "/bin/bash",
        command: "echo hi",
        workingDir: "/tmp/env/.meowbert/task-runs/task-1",
        timeoutMs: 60_000,
        maxOutputKb: 64,
        env: expect.objectContaining({
          TASK_DIR: "/tmp/env/.meowbert/task-runs/task-1",
          ENV_ROOT: "/tmp/env",
          TASK_INPUT_DIR: "/tmp/env/.meowbert/task-runs/task-1/inputs",
          PWD: "/tmp/env/.meowbert/task-runs/task-1",
          HOME: "/tmp/env",
          GITHUB_TOKEN: "secret"
        })
      })
    );
  });

  it("forwards abort signals to the sandbox handle", async () => {
    const controller = new AbortController();
    const executeInSandbox = vi.fn(async () => ({
      command: "sleep 10",
      stdout: "",
      stderr: "",
      exitCode: 130,
      timedOut: false,
      aborted: true
    }));
    const sandbox = {
      executeShellCommand: executeInSandbox
    } as unknown as DockerSandboxHandle;

    await executeShellCommand({
      sandbox,
      shell: "/bin/bash",
      command: "sleep 10",
      taskDir: "/tmp/env/task",
      envRoot: "/tmp/env",
      timeoutMs: 1_000,
      maxOutputKb: 64,
      abortSignal: controller.signal
    });

    expect(executeInSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        abortSignal: controller.signal
      })
    );
  });
});

describe("ensureTaskWorkspace", () => {
  it("opens the task directory chain to the sandbox without touching the files inside", async () => {
    const envRoot = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-task-workspace-"));
    tempRoots.push(envRoot);
    const taskDir = path.join(envRoot, ".meowbert", "task-runs", "task-1");
    const inputsDir = path.join(taskDir, "inputs");
    const docPath = path.join(inputsDir, "report.docx");

    await fs.mkdir(inputsDir, { recursive: true, mode: 0o755 });
    await fs.writeFile(docPath, "docx-bytes", { mode: 0o644 });
    await fs.chmod(path.join(envRoot, ".meowbert"), 0o755);
    await fs.chmod(path.join(envRoot, ".meowbert", "task-runs"), 0o755);
    await fs.chmod(taskDir, 0o755);
    await fs.chmod(inputsDir, 0o755);
    await fs.chmod(docPath, 0o644);

    await ensureTaskWorkspace(taskDir, envRoot);

    expect((await fs.stat(path.join(envRoot, ".meowbert"))).mode & 0o775).toBe(0o775);
    expect((await fs.stat(taskDir)).mode & 0o775).toBe(0o775);
    expect((await fs.stat(inputsDir)).mode & 0o775).toBe(0o775);
    expect((await fs.stat(docPath)).mode & 0o7777).toBe(0o644);
  });
});
