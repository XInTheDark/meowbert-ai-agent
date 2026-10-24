import os from "node:os";
import type http from "node:http";
import { isLocalTaskExecutionTarget, type AppConfig, type TaskExecutionJob } from "@meowbert/shared";
import { platformUsageRecorder } from "../tasks/platform-usage.js";
import { claimRunForApi, type RunClaim } from "./claim.js";
import { createRunApiHandler } from "./handler.js";
import { createRunApiServer } from "./server.js";
import { RunApiSessions } from "./sessions.js";
import { pruneRunApiRecords, sqlRunApiStores } from "./sql-stores.js";
import type { RunApiStores } from "./stores.js";
import { query } from "../../lib/db.js";

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export interface RunApiRuntime {
  claim(job: TaskExecutionJob): Promise<RunClaim>;
  // Drops the session of a run whose executor is gone; its lease lapses on its own.
  forget(runId: string): void;
  close(): Promise<void>;
}

// Starts this worker's Run API listener. Runs claimed here are answered here, and the API finds
// this listener through the claim's recorded URL.
export async function startRunApi(
  config: Pick<AppConfig, "security"> & { runApi: NonNullable<AppConfig["runApi"]> },
  stores: RunApiStores = sqlRunApiStores
): Promise<RunApiRuntime> {
  const sessions = new RunApiSessions();
  const leaseSecret = config.security.jwtSecret;
  const apiUrl = config.runApi.url ?? `http://${os.hostname()}:${config.runApi.port}`;
  const handler = createRunApiHandler({
    stores,
    sessions,
    leaseSecret,
    model: {
      weighUsage: async (model, counts) => (await platformUsageRecorder.computeCost(model, counts)).weightedTokens,
      chargeAbandoned: async (policy, model, counts) => {
        if (!policy.billing) return;
        await platformUsageRecorder.recordEvent(policy.billing, counts, await platformUsageRecorder.computeCost(model, counts));
      }
    }
  });
  const server = createRunApiServer(handler, {
    claim: async ({ runId, deviceId, body, secret }) => {
      if (secret !== leaseSecret || !deviceId) {
        return { status: 401, body: { error: { code: "unauthorized", message: "Invalid device claim credentials." } } };
      }
      const row = await query<{ payload_json: TaskExecutionJob }>(
        `SELECT payload_json FROM task_run_dispatches WHERE run_id = $1 AND lease_device_id = $2 AND queue_state = 'running'`,
        [runId, deviceId]
      );
      const job = row.rows[0]?.payload_json;
      const target = job?.executionTarget;
      if (!job || !target || !isLocalTaskExecutionTarget(target) || target.deviceId !== deviceId) {
        return { status: 409, body: { error: { code: "lease_lost", message: "This device is not the current owner of the run." } } };
      }
      const requestedJob = body && typeof body === "object" && "job" in body ? (body as { job?: unknown }).job : null;
      const claim = await claimRunForApi({
        job,
        holder: `device:${deviceId}`,
        apiUrl,
        leaseSecret,
        leases: stores.leases,
        sessions
      });
      void requestedJob;
      return { status: 200, body: claim };
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.runApi.port, () => resolve());
  });
  const holder = `worker:${os.hostname()}:${process.pid}`;
  console.log(`[run-api] Listening on port ${config.runApi.port}`);
  const pruneTimer = setInterval(() => {
    pruneRunApiRecords().catch((error) => console.error("[run-api] Pruning operation records failed", error));
  }, PRUNE_INTERVAL_MS);
  pruneTimer.unref();

  return {
    claim: (job) => claimRunForApi({ job, holder, apiUrl, leaseSecret, leases: stores.leases, sessions }),
    forget: (runId) => sessions.markFinished(runId),
    close: async () => {
      clearInterval(pruneTimer);
      await closeServer(server);
    }
  };
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
