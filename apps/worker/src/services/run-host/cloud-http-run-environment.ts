import type { TaskExecutionJob } from "@meowbert/shared";
import type { RunEnvironment } from "@meowbert/run-executor/agent/ports/run-environment";
import { createRunApiClient } from "@meowbert/run-executor/run-api/client";
import { createHttpRunControl } from "@meowbert/run-executor/run-api/http-run-control";
import { createProxyModelGateway } from "@meowbert/run-executor/run-api/proxy-model-gateway";
import { resolveInternalApiBaseUrl } from "../agent/internal-api-proxy.js";
import type { RunApiRuntime } from "../run-api/runtime.js";
import { cloudRunMachinery } from "./cloud-run-environment.js";

// A cloud run whose executor goes through the Run API and model proxy, the way a device's will.
// The worker claims the run, then talks to it through the API like any remote executor. Agent
// Swarm, subagents, Project Master and workflows stay database-backed hooks in this process.
export async function createCloudHttpRunEnvironment(
  job: TaskExecutionJob,
  runApi: RunApiRuntime
): Promise<{ environment: RunEnvironment; dispose: () => void }> {
  const { token } = await runApi.claim(job);
  const client = createRunApiClient({ baseUrl: `${resolveInternalApiBaseUrl()}/api`, runId: job.runId, token });
  const control = createHttpRunControl(client);
  return {
    environment: { control, models: createProxyModelGateway(client), ...cloudRunMachinery() },
    // A run that ended without completing or failing stops renewing its lease and lets it lapse.
    dispose: () => {
      control.stop();
      runApi.forget(job.runId);
    }
  };
}
