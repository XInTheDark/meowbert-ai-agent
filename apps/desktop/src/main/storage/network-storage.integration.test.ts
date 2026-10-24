import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { DockerSandboxManager } from "@meowbert/shared/docker-sandbox";
import { desktopDockerHost } from "../sandbox-image/manager";
import { probeDesktopSandboxStorage } from "../executor/sandbox-machine-host";

// Opt in on each Docker Desktop host with the actual mounted SMB/NFS backend.
const configured = ["TEST_LOCAL_STORAGE_ROOT", "TEST_LOCAL_STORAGE_BACKEND_ID", "TEST_LOCAL_STORAGE_INSTALL_ID", "TEST_LOCAL_SANDBOX_IMAGE"]
  .every((key) => Boolean(process.env[key]));
it.skipIf(!configured)("reads and writes named files through the actual Docker Desktop network bind mount", async () => {
  const root = await fs.realpath(process.env.TEST_LOCAL_STORAGE_ROOT!);
  const image = process.env.TEST_LOCAL_SANDBOX_IMAGE!;
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-mount-spike-"));
  const name = ".meowbert-probe-spike-" + randomUUID();
  const inputFile = path.join(root, name);
  const outputFile = path.join(root, name + "-result");
  const manager = new DockerSandboxManager({ provider: "docker", image, dockerHost: desktopDockerHost(),
    startTimeoutMs: 30_000, sessionIdleTimeoutMs: 60_000, envPassthroughPatterns: [],
    resources: { pids: 64, memoryMb: 512, cpus: 1, storageMb: 512 } });
  try {
    await probeDesktopSandboxStorage({ storageRoot: root, backendId: process.env.TEST_LOCAL_STORAGE_BACKEND_ID!,
      installId: process.env.TEST_LOCAL_STORAGE_INSTALL_ID!, deviceId: "network-acceptance", image, scratchRoot: scratch, skillsRootDir: null });
    await fs.writeFile(inputFile, "host-to-container", { flag: "wx" });
    const sandbox = await manager.createPersistentSandbox({ workingDir: root, networkEnabled: false, runAsRoot: true,
      mounts: [{ path: root }], labels: { purpose: "shell-exec", deviceId: "network-acceptance" } });
    try {
      const script = "const fs=require('fs'); const name=" + JSON.stringify(name) + "; if(fs.readFileSync(name,'utf8')!=='host-to-container') process.exit(1); fs.writeFileSync(name+'-result','container-to-host',{flag:'wx'});";
      const result = await sandbox.executeShellCommand({ shell: "/bin/bash", command: "node -e '" + script.replaceAll("'", "'\"'\"'") + "'",
        workingDir: root, timeoutMs: 10_000, maxOutputKb: 16 });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(await fs.readFile(outputFile, "utf8")).toBe("container-to-host");
    } finally { await sandbox.stop(); }
  } finally {
    await fs.rm(inputFile, { force: true });
    await fs.rm(outputFile, { force: true });
    await fs.rm(scratch, { recursive: true, force: true });
  }
}, 90_000);
