import type { ExecutorSettings } from "@meowbert/run-executor/agent/ports/executor-settings";
import { runAgentJob } from "@meowbert/run-executor/agent/index";
import { noRunFeatures } from "@meowbert/run-executor/agent/ports/run-features";
import { createRunApiClient } from "@meowbert/run-executor/run-api/client";
import { createHttpRunControl } from "@meowbert/run-executor/run-api/http-run-control";
import { createProxyModelGateway } from "@meowbert/run-executor/run-api/proxy-model-gateway";
import type { MachineHost } from "@meowbert/run-executor/agent/ports/machine-host";
import type { TaskExecutionJob } from "@meowbert/shared";
import { resolveVerifiedStoragePath, verifyMountedStorage } from "../storage/roots";
import { createDesktopSandboxMachineProvider } from "./sandbox-machine-host";
import type { DesktopLocalExecutorOptions } from "./local-executor";
import { createLocalPersistentShells } from "./persistent-shells";
import type { DeviceApi } from "./device-api";

export interface DeviceRunNotice { run_id: string; queue_state: string; payload_json: TaskExecutionJob }
export function startLocalRun(options: DesktopLocalExecutorOptions, api: DeviceApi, notice: DeviceRunNotice, image: string, skillsRootDir: string, settings: ExecutorSettings, installId: string) {
  const abort = new AbortController();
  let machine: MachineHost | null = null;
  let control: ReturnType<typeof createHttpRunControl> | null = null;
  const fence = async () => {
    abort.abort();
    control?.stop();
    await machine?.stop();
  };
  const done = (async () => {
    const check = await verifyMountedStorage({ mountPath: options.storageRoot, backendId: options.storageBackendId, deviceId: options.deviceId, installId });
    if (!check.ok || abort.signal.aborted) throw new Error("The workspace storage is unavailable.");
    const claim = await api.request<{ token: string }>("/api/devices/" + options.deviceId + "/runs/" + notice.run_id + "/claim", "POST", {});
    const client = createRunApiClient({ baseUrl: options.apiBaseUrl + "/api", runId: notice.run_id, token: claim.token, fetch: options.fetch, signal: abort.signal, requestTimeoutMs: 15_000 });
    const remote = createHttpRunControl(client, { onFenced: () => { void fence(); } });
    control = remote;
    const machines = createDesktopSandboxMachineProvider({ image, scratchRoot: options.scratchRoot, skillsRootDir, storageRoot: options.storageRoot, backendId: options.storageBackendId, deviceId: options.deviceId, installId });
    const platform = { ...remote.platform };
    try {
      await runAgentJob(notice.payload_json, {
        control: { ...remote, platform, bootstrap: async () => {
          const bootstrap = await remote.bootstrap();
          if (bootstrap.roots.storageBackendId !== options.storageBackendId) throw new Error("The run belongs to another storage backend.");
          const workspaceRoot = await resolveVerifiedStoragePath(options.storageRoot, bootstrap.roots.workspaceRootRelative);
          const envRoot = await resolveVerifiedStoragePath(options.storageRoot, bootstrap.roots.envRootRelative);
          return { ...bootstrap, roots: { ...bootstrap.roots, workspaceRoot, envRoot } };
        } },
        models: createProxyModelGateway(client),
        machines: { ...machines, start: async (spec) => {
          if (abort.signal.aborted) throw new Error("The local executor has stopped.");
          machine = await machines.start(spec);
          if (abort.signal.aborted) { await machine.stop(); throw new Error("The local executor has stopped."); }
          Object.assign(platform, createLocalPersistentShells({ machine, spec, signal: abort.signal }));
          return machine;
        } },
        features: noRunFeatures,
        settings: { ...settings, sharedDependenciesDirectory: "shared-linux-arm64", skills: { ...settings.skills, rootDir: skillsRootDir } }
      });
    } finally { remote.stop(); await fence(); }
  })();
  return { done, fence, image };
}
