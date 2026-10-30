import type { DockerSandboxHandle } from "@meowbert/shared/docker-sandbox";
import { workerSandboxManager } from "../runtime/sandbox.js";
import { buildTaskSandboxMounts } from "@meowbert/run-executor/agent/task-write-scope";
import { ensureTaskSourceMounts, releaseTaskSourceMounts } from "../agent/live-sync-client.js";
import { prepareTaskSourceMounts, verifyTaskSourceMounts } from "../agent/live-sync-mounts.js";
import { createRecoverableSandboxController } from "../agent/recoverable-sandbox.js";
import { ensureTaskScratchDir } from "../tasks/task-scratch.js";
import type { MachineHost, MachineProvider, MachineSpec } from "@meowbert/run-executor/agent/ports/machine-host";

async function createSandbox(spec: MachineSpec): Promise<DockerSandboxHandle> {
  const mounts = await buildTaskSandboxMounts({
    envRoot: spec.envRoot,
    workspaceRoot: spec.workspaceRoot,
    taskScratchDir: spec.taskScratchDir,
    readOnly: spec.readOnly,
    skillsRootDir: spec.skillsRootDir
  });
  await spec.log("Built sandbox mount plan.", {
    stage: "startup.sandbox.mount_plan",
    phase: "success",
    mountCount: mounts.length,
    writableMountCount: mounts.filter((mount) => mount.readOnly !== true).length,
    mounts: mounts.map((mount) => ({
      path: mount.path,
      readOnly: mount.readOnly === true,
      optional: mount.optional === true
    }))
  });
  const sourceMountPaths = await ensureTaskSourceMounts({
    userId: spec.actorUserId,
    taskId: spec.taskId,
    workspaceId: spec.workspaceId
  });
  const sourceMounts = await prepareTaskSourceMounts(sourceMountPaths, spec.readOnly);
  const sandbox = await workerSandboxManager.createPersistentSandbox({
    workingDir: spec.taskDir,
    networkEnabled: spec.networkEnabled,
    mounts: [...mounts, ...sourceMounts],
    env: spec.env,
    runAsRoot: spec.runAsRoot,
    resources: spec.resources,
    labels: {
      purpose: "task-run",
      workspaceId: spec.workspaceId,
      environmentId: spec.environmentId,
      taskId: spec.taskId,
      runId: spec.runId
    },
    onLifecycleEvent: async (event) => {
      await spec.log(event.message, {
        stage: `startup.${event.stage}`,
        phase: event.phase,
        ...(event.payload ?? {})
      });
    }
  });
  try {
    await verifyTaskSourceMounts(sandbox, sourceMountPaths, spec.taskDir);
    return sandbox;
  } catch (error) {
    await sandbox.stop();
    throw error;
  }
}

async function createLoggedSandbox(spec: MachineSpec): Promise<DockerSandboxHandle> {
  await spec.log("Creating task sandbox.", { stage: "startup.sandbox", phase: "start" });
  try {
    const sandbox = await createSandbox(spec);
    await spec.log("Created task sandbox.", {
      stage: "startup.sandbox",
      phase: "success",
      taskDir: spec.taskDir,
      networkEnabled: spec.networkEnabled,
      runAsRoot: spec.runAsRoot
    });
    return sandbox;
  } catch (error) {
    await spec.log("Failed to create task sandbox.", {
      stage: "startup.sandbox",
      phase: "error",
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

async function startSandboxMachine(spec: MachineSpec): Promise<MachineHost> {
  const releaseSourceMounts = () => releaseTaskSourceMounts({
    userId: spec.actorUserId,
    taskId: spec.taskId,
    workspaceId: spec.workspaceId
  }).catch(() => undefined);
  const create = () => createLoggedSandbox(spec);
  try {
    const controller = createRecoverableSandboxController({
      create,
      warmUp: spec.startEagerly,
      onRecovered: (recovery) => spec.log("Replaced crashed task sandbox.", {
        stage: "sandbox.recovery",
        phase: "success",
        detail: recovery.message
      })
    });
    return {
      sandbox: controller.sandbox,
      initialize: controller.initializeSandbox,
      stop: async () => {
        await controller.sandbox.stop();
        await releaseSourceMounts();
      }
    };
  } catch (error) {
    await releaseSourceMounts();
    throw error;
  }
}

// Runs task commands in containers on this host's Docker daemon.
export const sandboxMachineProvider: MachineProvider = {
  prepareScratchDir: (input) => ensureTaskScratchDir(input),
  start: startSandboxMachine
};
