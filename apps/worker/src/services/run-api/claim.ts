import type { TaskExecutionJob } from "@meowbert/shared";
import { RUN_LEASE_TTL_MS } from "@meowbert/shared";
import { signRunLeaseToken } from "@meowbert/shared/run-lease-token";
import { resolveRunToolOptions } from "@meowbert/run-executor/agent/runtime";
import type { ServerRunState } from "../run-host/bootstrap.js";
import { createDirectRunServices } from "../run-host/cloud-run-environment.js";
import { resolvePurposeModel } from "../run-host/direct-model-gateway.js";
import type { RunApiSessions, RunModelPolicy } from "./sessions.js";
import type { RunLeaseStore } from "./stores.js";

export interface RunClaim {
  token: string;
  epoch: number;
}

function modelPolicy(state: ServerRunState): RunModelPolicy {
  const { runtime } = state.bootstrap;
  return {
    billing: state.billing,
    quotaExempt: state.quotaExempt,
    model: (purpose) => resolvePurposeModel(state, purpose),
    maxContextTokens: runtime.maxContextTokens,
    modelPayload: runtime.modelPayload,
    allowHostedWebSearch: resolveRunToolOptions(state.snapshot, state.job, state.bootstrap.memoryEnabled).webSearch === true
  };
}

// Takes a run for an executor that reaches it over the Run API: the control plane bootstraps the
// run here, takes its lease for a new epoch, and keeps a session the run's calls are answered from.
export async function claimRunForApi(input: {
  job: TaskExecutionJob;
  holder: string;
  apiUrl: string;
  leaseSecret: string;
  leases: RunLeaseStore;
  sessions: RunApiSessions;
}): Promise<RunClaim> {
  const { job } = input;
  const { control, models } = createDirectRunServices(job);
  const bootstrap = await control.bootstrap();
  const lease = await input.leases.claim({ runId: job.runId, holder: input.holder, apiUrl: input.apiUrl, ttlMs: RUN_LEASE_TTL_MS });
  if (!lease) {
    throw new Error("The run is no longer admitted, so it cannot be claimed.");
  }
  input.sessions.add({
    runId: job.runId,
    taskId: job.taskId,
    epoch: lease.epoch,
    holder: input.holder,
    control,
    models,
    policy: () => modelPolicy(control.serverState()),
    leafMessageId: bootstrap.snapshot.branch_leaf_message_id,
    lastEventSeq: 0,
    modelRequestInFlight: false,
    finishedAt: null
  });
  return {
    epoch: lease.epoch,
    token: signRunLeaseToken({ runId: job.runId, taskId: job.taskId, epoch: lease.epoch, holder: input.holder }, input.leaseSecret)
  };
}
