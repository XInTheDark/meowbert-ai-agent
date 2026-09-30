import { describe, expect, it, vi } from "vitest";
import type { DockerSandboxHandle, SandboxCrashReport } from "@meowbert/shared/docker-sandbox";
import { createRecoverableSandboxController } from "./recoverable-sandbox.js";

const commandInput = {
  command: "python3 big.py",
  shell: "/bin/bash",
  workingDir: "/task",
  timeoutMs: 1_000,
  maxOutputKb: 64
};

const oomReport: SandboxCrashReport = {
  containerId: "660a868b64b57ec1f04137db",
  state: { status: "exited", exitCode: 137, oomKilled: true, error: null, startedAt: null, finishedAt: null },
  limits: { memoryMb: 640, cpus: 1, pids: 400 },
  recentEvents: "2026-09-29T00:03:16.000Z oom\n2026-09-29T00:03:16.100Z die exitCode=137"
};

function fakeSandbox(input: {
  id: string;
  execute: DockerSandboxHandle["executeShellCommand"];
  crashReport?: SandboxCrashReport | null;
}) {
  return {
    id: input.id,
    executeShellCommand: vi.fn(input.execute),
    startAttachedProcess: vi.fn(),
    readCrashReport: vi.fn(async () => input.crashReport ?? null),
    stop: vi.fn(async () => {})
  };
}

function exitResult(exitCode: number) {
  return { command: commandInput.command, stdout: "", stderr: "", exitCode, timedOut: false, aborted: false };
}

describe("createRecoverableSandboxController", () => {
  it("replaces a crashed container and reports the crash on the failing command", async () => {
    const crashed = fakeSandbox({ id: "old", execute: async () => exitResult(128), crashReport: oomReport });
    const replacement = fakeSandbox({ id: "new", execute: async () => exitResult(0) });
    const controller = createRecoverableSandboxController({
      initial: crashed as unknown as DockerSandboxHandle,
      create: async () => replacement as unknown as DockerSandboxHandle
    });

    const failed = await controller.sandbox.executeShellCommand(commandInput);
    expect(failed.exitCode).toBe(128);
    expect(failed.sandboxCrash).toContain("\"oomKilled\":true");
    expect(failed.sandboxCrash).toContain("\"memoryMb\":640");
    expect(crashed.stop).toHaveBeenCalled();
    expect(controller.sandbox.id).toBe("new");

    const next = await controller.sandbox.executeShellCommand(commandInput);
    expect(next.exitCode).toBe(0);
    expect(replacement.executeShellCommand).toHaveBeenCalledTimes(1);
  });

  it("recovers when Docker rejects the exec because the container is gone", async () => {
    const crashed = fakeSandbox({
      id: "old",
      execute: async () => {
        throw new Error("(HTTP code 409) container stopped/paused");
      },
      crashReport: { ...oomReport, state: null, limits: null }
    });
    const replacement = fakeSandbox({ id: "new", execute: async () => exitResult(0) });
    const controller = createRecoverableSandboxController({
      initial: crashed as unknown as DockerSandboxHandle,
      create: async () => replacement as unknown as DockerSandboxHandle
    });

    await expect(controller.sandbox.executeShellCommand(commandInput))
      .rejects.toThrow(/container stopped\/paused[\s\S]*new one was started[\s\S]*state: removed/);
    await expect(controller.sandbox.executeShellCommand(commandInput)).resolves.toMatchObject({ exitCode: 0 });
  });

  it("keeps a running container after an ordinary command failure", async () => {
    const running = fakeSandbox({ id: "live", execute: async () => exitResult(1), crashReport: null });
    const create = vi.fn();
    const controller = createRecoverableSandboxController({
      initial: running as unknown as DockerSandboxHandle,
      create
    });

    const result = await controller.sandbox.executeShellCommand(commandInput);
    expect(result.sandboxCrash).toBeUndefined();
    expect(running.stop).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(controller.sandbox.id).toBe("live");
  });

  it("creates the sandbox lazily when no initial container is provided", async () => {
    const created = fakeSandbox({ id: "lazy", execute: async () => exitResult(0) });
    const create = vi.fn(async () => created as unknown as DockerSandboxHandle);
    const controller = createRecoverableSandboxController({ create });

    expect(create).not.toHaveBeenCalled();
    await expect(controller.initializeSandbox()).resolves.toEqual({ alreadyInitialized: false });
    await expect(controller.initializeSandbox()).resolves.toEqual({ alreadyInitialized: true });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
