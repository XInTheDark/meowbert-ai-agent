import path from "node:path";
import os from "node:os";
import type { ExecutorSettings } from "@meowbert/run-executor/agent/ports/executor-settings";
import type { RunEnvironment } from "@meowbert/run-executor/agent/ports/run-environment";
import type { MachineHost } from "@meowbert/run-executor/agent/ports/machine-host";
import type { RunBootstrap } from "@meowbert/run-executor/agent/ports/run-bootstrap";
import type { PlatformToolHost } from "@meowbert/run-executor/agent/ports/platform-tools";
import type { RunApiClient } from "@meowbert/run-executor/run-api/client";
import type { createHttpRunControl } from "@meowbert/run-executor/run-api/http-run-control";
import { createProxyModelGateway } from "@meowbert/run-executor/run-api/proxy-model-gateway";
import { noRunFeatures } from "@meowbert/run-executor/agent/ports/run-features";
import { startMcpServer } from "@meowbert/run-executor/agent/mcp-client";
import { getHostBrowser } from "../browser-use/runtime";
import { createHostMachineProvider } from "./host-machine-host";
import { createDesktopSandboxMachineProvider } from "./sandbox-machine-host";
import { createHostPersistentShells } from "./host-persistent-shells";
import { createLocalPersistentShells } from "./persistent-shells";
import { sharedSandboxDependencies } from "../sandbox-image/platform";
import type { DesktopLocalExecutorOptions } from "./local-executor";

export function localRunEnvironment(input: {
  options: DesktopLocalExecutorOptions; taskId: string; host: boolean; image: string; skillsRootDir: string;
  settings: ExecutorSettings; installId: string; signal: AbortSignal; bootstrap: RunBootstrap; platform: PlatformToolHost;
  client: RunApiClient; remote: ReturnType<typeof createHttpRunControl>; onMachine: (machine: MachineHost) => void;
  workspaceRelocationNote?: string;
}): RunEnvironment {
  const { options, host, image, skillsRootDir, settings, installId, signal, platform } = input;
  const machines = host ? createHostMachineProvider({ scratchRoot: options.scratchRoot,
    runsRoot: options.runsRoot ?? path.join(options.scratchRoot, "../runs"), consent: options.hostConsent === true })
    : createDesktopSandboxMachineProvider({ image, scratchRoot: options.scratchRoot, skillsRootDir,
      liveFolderPaths: (input.bootstrap.liveSyncFiles ?? []).filter((file) => file.provider === "google-drive" && file.linkKind === "folder").map((file) => file.taskRelativePath),
      storageRoot: options.storageRoot, backendId: options.storageBackendId, deviceId: options.deviceId, installId });
  return {
    control: { ...input.remote, platform, bootstrap: async () => input.bootstrap, setTaskStatus: async (status) => {
      const accepted = await input.remote.setTaskStatus(status);
      if (accepted && status === "running") options.onRunStarted?.(input.taskId);
      return accepted;
    } }, models: createProxyModelGateway(input.client),
    machines: { ...machines, start: async (spec) => {
      signal.throwIfAborted();
      const machine = await machines.start(spec);
      input.onMachine(machine);
      if (signal.aborted) { await machine.stop(); signal.throwIfAborted(); }
      Object.assign(platform, host ? createHostPersistentShells({ machine, spec, signal }) : createLocalPersistentShells({ machine, spec, signal }));
      return machine;
    } },
    features: noRunFeatures,
    connectSkill: (manifest, dir, sandbox, timeout, env) => {
      signal.throwIfAborted();
      if (manifest.id === "host-browser") {
        if (!options.hostBrowserEnabled) throw new Error("Your Chrome is disabled on this device.");
        return getHostBrowser(options.resourcesRoot).connect(input.taskId, signal);
      }
      return startMcpServer(manifest, dir, sandbox, timeout, env);
    },
    settings: { ...settings, hostMode: host, hostBrowserEnabled: options.hostBrowserEnabled, workspaceRelocationNote: input.workspaceRelocationNote,
      shell: host ? (process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/zsh") : settings.shell,
      sharedDependenciesDirectory: host ? ".meowbert/shared-" + os.platform() + "-" + os.arch() : sharedSandboxDependencies(),
      sandboxPdfPreparation: !host, sandboxSkillsRootDir: !host && process.platform === "win32" ? "/app/skills" : undefined,
      skills: { ...settings.skills, rootDir: host ? options.hostSkillsRoot ?? skillsRootDir : skillsRootDir } }
  };
}
