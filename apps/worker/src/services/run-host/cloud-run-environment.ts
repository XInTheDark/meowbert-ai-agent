import type { TaskExecutionJob } from "@meowbert/shared";
import { emitTaskEvent } from "../runtime/events.js";
import { createTaskDebugLogger } from "../runtime/debug-task-events.js";
import { createNetworkRequestLogger } from "../agent/network-request-event-storage.js";
import type { RunEnvironment } from "@meowbert/run-executor/agent/ports/run-environment";
import { executorSettingsFromConfig } from "@meowbert/run-executor/agent/ports/executor-settings";
import { config } from "../../lib/config.js";
import { createDbRunControl, type DbRunControl } from "./db-run-control.js";
import type { ModelGateway } from "@meowbert/run-executor/agent/ports/model-gateway";
import { createDirectModelGateway } from "./direct-model-gateway.js";
import { sandboxMachineProvider } from "./sandbox-machine-host.js";
import { cloudRunFeatures } from "./cloud-run-features.js";

// The run's control and model access straight against the database and the provider keys.
export function createDirectRunServices(job: TaskExecutionJob): { control: DbRunControl; models: ModelGateway } {
  const control = createDbRunControl(job, createTaskDebugLogger(job.taskId));
  const models = createDirectModelGateway({
    requireRun: () => control.serverState(),
    onNetworkRequest: (event) => createNetworkRequestLogger(
      job.taskId,
      control.serverState().bootstrap.runtime.networkRequestLoggingEnabled
    )(event),
    reportTurnUsageError: (message) => emitTaskEvent(job.taskId, "error", { message })
  });
  return { control, models };
}

// A run executed inside the control plane: database, provider keys and Docker are all local.
export function createCloudRunEnvironment(job: TaskExecutionJob): RunEnvironment {
  return { ...createDirectRunServices(job), ...cloudRunMachinery() };
}

// What any run executed on a cloud worker uses, whichever way it reaches the control plane.
export function cloudRunMachinery(): Pick<RunEnvironment, "machines" | "settings" | "features"> {
  return { machines: sandboxMachineProvider, settings: executorSettingsFromConfig(config), features: cloudRunFeatures };
}
