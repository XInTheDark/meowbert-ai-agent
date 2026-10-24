import fs from "node:fs/promises";
import path from "node:path";
import { DockerSandboxManager } from "@meowbert/shared/docker-sandbox";
import { getSandboxNetworkEnabled, type SandboxConfig } from "@meowbert/shared";
import { buildTaskSandboxMounts } from "@meowbert/run-executor/agent/task-write-scope";
import { desktopDockerHost } from "../sandbox-image/manager";
import type { MachineHost, MachineProvider, MachineSpec } from "@meowbert/run-executor/agent/ports/machine-host";

export interface DesktopSandboxMachineOptions {
  image: string;
  storageRoot: string;
  backendId: string;
  installId: string;
  deviceId: string;
  dockerHost?: string;
  scratchRoot: string;
  skillsRootDir: string | null;
  resources?: SandboxConfig["resources"];
}

function makeSandboxConfig(options: DesktopSandboxMachineOptions): SandboxConfig {
  return {
    provider: "docker",
    image: options.image,
    dockerHost: options.dockerHost ?? desktopDockerHost(),
    startTimeoutMs: 30_000,
    sessionIdleTimeoutMs: 45 * 60 * 1_000,
    envPassthroughPatterns: [],
    resources: options.resources ?? { pids: 256, memoryMb: 2048, cpus: 2, storageMb: 4096 }
  };
}

export function createDesktopSandboxMachineProvider(options: DesktopSandboxMachineOptions): MachineProvider {
  const manager = new DockerSandboxManager(makeSandboxConfig(options));
  return {
    async prepareScratchDir(input) {
      const scratch = path.join(options.scratchRoot, input.workspaceId, input.taskId);
      await fs.mkdir(scratch, { recursive: true });
      return scratch;
    },
    async start(spec: MachineSpec): Promise<MachineHost> {
      await verifyDockerStorage(manager, options);
      await fs.mkdir(spec.taskDir, { recursive: true });
      const mounts = await buildTaskSandboxMounts({
        envRoot: spec.envRoot,
        workspaceRoot: spec.workspaceRoot,
        taskScratchDir: spec.taskScratchDir,
        isThreadTask: spec.isThreadTask,
        skillsRootDir: options.skillsRootDir
      });
      const sandbox = await manager.createPersistentSandbox({
        workingDir: spec.taskDir,
        networkEnabled: spec.networkEnabled,
        mounts,
        env: spec.env,
        runAsRoot: spec.runAsRoot,
        resources: {
          memoryMb: Math.min(spec.resources.memoryMb ?? 2048, options.resources?.memoryMb ?? 2048),
          cpus: Math.min(spec.resources.cpus ?? 2, options.resources?.cpus ?? 2),
          pids: Math.min(spec.resources.pids ?? 256, options.resources?.pids ?? 256)
        },
        labels: {
          purpose: "task-run",
          deviceId: options.deviceId,
          workspaceId: spec.workspaceId,
          environmentId: spec.environmentId,
          taskId: spec.taskId,
          runId: spec.runId
        },
        onLifecycleEvent: async (event) => spec.log(event.message, {
          stage: `desktop.${event.stage}`,
          phase: event.phase,
          ...(event.payload ?? {})
        })
      });
      return {
        sandbox,
        initialize: async () => ({ alreadyInitialized: true }),
        stop: () => sandbox.stop()
      };
    }
  };
}

export function sandboxNetworkEnabled(payload: Record<string, unknown>): boolean {
  return getSandboxNetworkEnabled(payload);
}


export async function verifyDockerStorage(manager: DockerSandboxManager, options: DesktopSandboxMachineOptions): Promise<void> {
  const probe = await manager.createPersistentSandbox({
    workingDir: options.storageRoot, networkEnabled: false, runAsRoot: true,
    mounts: [{ path: options.storageRoot }],
    labels: { purpose: "shell-exec", deviceId: options.deviceId }
  });
  try {
    const script = [
      "const fs = require('fs');",
      "const path = require('path');",
      "const root = process.cwd();",
      "const marker = JSON.parse(fs.readFileSync(path.join(root, '.meowbert-storage.json'), 'utf8'));",
      "if (marker.version !== 1 || marker.backendId !== " + JSON.stringify(options.backendId) + " || marker.installId !== " + JSON.stringify(options.installId) + ") throw Error('Wrong storage backend');",
      "const probe = path.join(root, '.meowbert-probe-' + " + JSON.stringify(options.deviceId) + " + '-' + require('crypto').randomUUID());",
      "fs.writeFileSync(probe, 'docker-probe', {flag:'wx'}); fs.unlinkSync(probe);"
    ].join(" ");
    const command = "node -e '" + script.replaceAll("'", "'\"'\"'") + "'";
    const result = await probe.executeShellCommand({ command, shell: "/bin/bash", workingDir: options.storageRoot, timeoutMs: 10_000, maxOutputKb: 16 });
    if (result.exitCode !== 0) throw new Error("Docker Desktop cannot access the selected storage root: " + result.stderr);
  } finally { await probe.stop(); }
}

export async function probeDesktopSandboxStorage(options: DesktopSandboxMachineOptions): Promise<void> {
  await verifyDockerStorage(new DockerSandboxManager(makeSandboxConfig(options)), options);
}
