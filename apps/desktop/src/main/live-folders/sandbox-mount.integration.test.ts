import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { DockerSandboxManager, type MachineHandle } from "@meowbert/shared/docker-sandbox";
import { desktopDockerHost } from "../sandbox-image/manager";
import { startNativeLiveFolder } from "./native-mount";
import { verifySandboxLiveFolders } from "./sandbox-probe";

it.skipIf(process.platform !== "darwin" || !process.env.TEST_LIVE_FOLDER_SANDBOX_IMAGE)("reads and writes a native live folder inside Docker Desktop", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-drive-sandbox-"));
  const source = path.join(root, "source");
  const taskDir = path.join(root, "task");
  await fs.mkdir(source); await fs.mkdir(taskDir);
  await fs.writeFile(path.join(source, "input.txt"), "source-to-sandbox");
  let mount: Awaited<ReturnType<typeof startNativeLiveFolder>> | null = null;
  let sandbox: MachineHandle | null = null;
  try {
    mount = await startNativeLiveFolder({ root: path.join(root, "live-folders"),
      binary: path.resolve("dist/live-folder-runtime/rclone-" + process.arch), signal: new AbortController().signal,
      folder: { linkId: randomUUID(), connectionId: "a".repeat(64), accountLabel: "sandbox acceptance fixture", localRelativePath: "context/test",
        config: "[google-drive]\ntype = alias\nremote = " + source + "\n" } });
    const manager = new DockerSandboxManager({ provider: "docker", image: process.env.TEST_LIVE_FOLDER_SANDBOX_IMAGE!,
      dockerHost: desktopDockerHost(), startTimeoutMs: 30_000, sessionIdleTimeoutMs: 60_000, envPassthroughPatterns: [],
      resources: { pids: 64, memoryMb: 512, cpus: 1, storageMb: 512 } });
    sandbox = await manager.createPersistentSandbox({ workingDir: taskDir, networkEnabled: false, runAsRoot: false,
      mounts: [{ path: taskDir }, { path: mount.path }], labels: { purpose: "task-run" } });
    await verifySandboxLiveFolders({ sandbox, paths: [mount.path], taskDir, readOnly: false });
    const result = await sandbox.executeShellCommand({ command: "cat '" + path.join(mount.path, "input.txt") + "'",
      shell: "/bin/sh", workingDir: taskDir, timeoutMs: 10_000, maxOutputKb: 1 });
    expect(result.exitCode).toBe(0); expect(result.stdout).toBe("source-to-sandbox");
    const output = await sandbox.executeShellCommand({ command: "printf sandbox-to-source > '" + path.join(mount.path, "output.txt")
      + "' && test ! -e '" + path.join(root, "live-folders", "credentials") + "'",
      shell: "/bin/sh", workingDir: taskDir, timeoutMs: 10_000, maxOutputKb: 1 });
    expect(output.exitCode).toBe(0);
    await expect.poll(() => fs.readFile(path.join(source, "output.txt"), "utf8"), { timeout: 15_000 }).toBe("sandbox-to-source");
  } finally {
    await sandbox?.stop(); await mount?.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);
