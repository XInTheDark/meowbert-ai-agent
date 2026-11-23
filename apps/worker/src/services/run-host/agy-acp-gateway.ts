import {
  resolveAgyAcpConfigForModel,
  type ModelUsageCounts,
  type TaskExecutionJob
} from "@meowbert/shared";
import { BridgeSession } from "@meowbert/run-executor/bridge/index";
import type { ModelGateway } from "@meowbert/run-executor/agent/ports/model-gateway";
import type { RunFinishedOutcome } from "@meowbert/run-executor/agent/ports/run-environment";
import { query } from "../../lib/db.js";
import { chargeSwarmStep } from "../agent-swarm/budget.js";
import { loadSwarmRunContext } from "../agent-swarm/config.js";
import { AgyAcpDriver } from "../agy-acp/agy-acp-driver.js";
import { ensureWorkerBridgeHost, type WorkerBridgeHost } from "../agy-acp/agy-bridge-host.js";
import { hydrateSelectedAgyProfile } from "../agy-acp/agy-profile-dir.js";
import { platformUsageRecorder } from "../tasks/platform-usage.js";
import type { ServerRunState } from "./bootstrap.js";

const AGY_CONNECT_TIMEOUT_MS = 60_000;
const AGY_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const GRACEFUL_USAGE_WAIT_MS = 5_000;

interface ActiveAgyRuntime {
  registrationId: string;
  session: BridgeSession;
  driver: AgyAcpDriver;
  bridgeHost: WorkerBridgeHost;
  lastInputLength: number;
}

export interface AgyAwareModelGatewayOptions {
  job: TaskExecutionJob;
  requireRun: () => ServerRunState;
  directModels: ModelGateway;
  reportTurnUsageError: (message: string) => Promise<void>;
}

async function chargeDelayedAgyBudgets(run: ServerRunState, weightedTokens: number): Promise<void> {
  const tokens = Math.max(0, Math.floor(weightedTokens));
  if (tokens <= 0) return;
  await query("UPDATE tasks SET spent_tokens = spent_tokens + $2 WHERE id = $1", [run.job.taskId, tokens]).catch(() => undefined);
  const swarm = await loadSwarmRunContext(run.snapshot.task, run.snapshot.platform_model_routers ?? []).catch(() => null);
  if (swarm) {
    await chargeSwarmStep(swarm, run.job.taskId, tokens).catch(() => undefined);
  }
}

async function recordAgyUsage(
  run: ServerRunState,
  counts: ModelUsageCounts,
  reportTurnUsageError: (message: string) => Promise<void>
): Promise<void> {
  try {
    const cost = await platformUsageRecorder.computeCost(run.bootstrap.runtime.model, counts);
    if (run.billing) {
      await platformUsageRecorder.recordEvent(run.billing, counts, cost);
    }
    const budgetTokens = cost.weightedTokens > 0
      ? cost.weightedTokens
      : counts.inputTokens + counts.outputTokens;
    await chargeDelayedAgyBudgets(run, budgetTokens);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await reportTurnUsageError(`Failed to record Antigravity token usage: ${message}`);
  }
}

function attachLiveContextUsage(
  response: Awaited<ReturnType<BridgeSession["handleModelTurn"]>>,
  contextUsage: { used: number; size: number } | null
): void {
  if (!contextUsage || contextUsage.used <= 0) return;
  (response as { usage?: unknown }).usage = {
    input_tokens: contextUsage.used,
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: 0,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: contextUsage.used
  };
}

export function createAgyAwareModelGateway(options: AgyAwareModelGatewayOptions): {
  models: ModelGateway;
  onRunFinished: (outcome: RunFinishedOutcome) => void;
} {
  let active: ActiveAgyRuntime | null = null;
  let starting: Promise<ActiveAgyRuntime> | null = null;
  let sessionEpoch = 0;

  function retireActive(outcome: RunFinishedOutcome): void {
    const current = active;
    active = null;
    if (!current) return;
    current.session.onRunEnded(outcome);
    current.bridgeHost.registry.unregister(current.registrationId);
    const gracefulPromptWaitMs = outcome.status === "completed" ? GRACEFUL_USAGE_WAIT_MS : 0;
    void current.driver.stop({ gracefulPromptWaitMs }).catch((error) => {
      console.warn("[agy-acp] Error stopping Antigravity ACP driver", {
        runId: options.job.runId,
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }

  async function ensureActive(run: ServerRunState, currentInputLength: number): Promise<ActiveAgyRuntime> {
    if (active && currentInputLength < active.lastInputLength) {
      retireActive({
        status: "completed",
        message: "Context window rolled over after prompt cache expiry; continuing in a fresh ACP session."
      });
    }
    if (active) return active;
    if (starting) return starting;

    starting = (async () => {
      const [bridgeHost, profile] = await Promise.all([
        ensureWorkerBridgeHost(),
        hydrateSelectedAgyProfile({ taskId: options.job.taskId })
      ]);
      const session = new BridgeSession({
        connectTimeoutMs: AGY_CONNECT_TIMEOUT_MS,
        idleTimeoutMs: AGY_IDLE_TIMEOUT_MS
      });
      const registrationId = sessionEpoch === 0 ? options.job.runId : `${options.job.runId}:e${sessionEpoch}`;
      sessionEpoch += 1;
      const handoff = bridgeHost.registry.register({
        runId: registrationId,
        taskId: options.job.taskId,
        mode: "sandbox",
        session
      });
      const agyConfig = resolveAgyAcpConfigForModel(
        run.bootstrap.runtime.model,
        run.snapshot.platform_model_metadata
      );
      const driver = new AgyAcpDriver({
        profile,
        bridgeHost,
        bridgeSession: session,
        sessionCode: handoff.sessionCode,
        agyModel: agyConfig.agyModel,
        agyThinkingLevel: agyConfig.agyThinkingLevel,
        onUsage: async (counts) => {
          await recordAgyUsage(run, counts, options.reportTurnUsageError);
        }
      });
      void driver.start();
      const runtime: ActiveAgyRuntime = {
        registrationId,
        session,
        driver,
        bridgeHost,
        lastInputLength: currentInputLength
      };
      active = runtime;
      return runtime;
    })().finally(() => {
      starting = null;
    });

    return starting;
  }

  const models: ModelGateway = {
    async create(request) {
      const run = options.requireRun();
      if (run.bootstrap.runtime.modelType !== "agy_acp") {
        return options.directModels.create(request);
      }
      if (request.purpose === "compaction") {
        throw new Error("Context compaction is disabled during Antigravity ACP runs.");
      }
      if (request.purpose !== "turn") {
        return options.directModels.create(request);
      }
      const currentInputLength = Array.isArray(request.body.input) ? request.body.input.length : 0;
      const runtime = await ensureActive(run, currentInputLength);
      runtime.lastInputLength = currentInputLength;
      const response = await runtime.session.handleModelTurn(request.body, request.signal);
      attachLiveContextUsage(response, runtime.driver.getLatestContextUsage());
      // Return 0 so loop/harness budgets don't double-charge live context occupancy;
      // actual turn cost is charged directly in onUsage when ACP returns result.usage.
      return { response, weightedTokens: 0 };
    },
    isQuotaExceeded: () => options.directModels.isQuotaExceeded?.() ?? Promise.resolve(false)
  };

  function onRunFinished(outcome: RunFinishedOutcome): void {
    retireActive(outcome);
  }

  return { models, onRunFinished };
}
