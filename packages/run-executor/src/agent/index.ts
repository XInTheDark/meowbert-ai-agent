import type { TaskExecutionJob } from "@meowbert/shared";
import { maybeHandleCompactOnlyRun } from "./compact-only.js";
import { handleAgentRunFailure } from "./failure.js";
import { finalizeAgentRun } from "./finalize.js";
import { runAgentStepLoop } from "./loop.js";
import { initializeAgentExecution } from "./setup.js";
import { prepareAgentRunContext } from "./runtime.js";
import type { AgentFailureContext } from "./execution-types.js";
import { createRunDebugLogger } from "./run-debug-logger.js";
import type { RunEnvironment, RunFinishedOutcome } from "./ports/run-environment.js";

function buildFailureContext(job: TaskExecutionJob, prepared: Awaited<ReturnType<typeof prepareAgentRunContext>>): AgentFailureContext {
  return {
    job,
    prepared,
    state: {
      currentLeafMessageId: prepared.currentLeafMessageId
    }
  };
}

export async function runAgentJob(job: TaskExecutionJob, environment: RunEnvironment): Promise<void> {
  const debugLogger = createRunDebugLogger(environment.control);
  await debugLogger.log("Worker claimed admitted run.", {
    stage: "worker.pickup",
    phase: "success",
    runId: job.runId,
    mode: job.mode ?? "default"
  });
  const prepared = await prepareAgentRunContext(job, environment, debugLogger);
  let execution = null as Awaited<ReturnType<typeof initializeAgentExecution>> | null;
  let finishOutcome: RunFinishedOutcome = { status: "failed" };

  try {
    execution = await initializeAgentExecution(job, prepared, debugLogger);
    if (await maybeHandleCompactOnlyRun(execution)) {
      finishOutcome = { status: "completed" };
      return;
    }

    await runAgentStepLoop(execution);
    await finalizeAgentRun(execution);
    finishOutcome = execution.state.bridgeParkedReason
      ? { status: "parked", message: execution.state.bridgeParkedReason }
      : { status: "completed" };
  } catch (error) {
    const isCancelled = error instanceof Error && error.message === "TASK_CANCELLED";
    finishOutcome = isCancelled
      ? { status: "cancelled" }
      : { status: "failed", message: error instanceof Error ? error.message : String(error) };
    await handleAgentRunFailure(execution ?? buildFailureContext(job, prepared), error);
  } finally {
    environment.onRunFinished?.(finishOutcome);
    if (execution?.runTiming.runTimeLimitTimer) {
      clearTimeout(execution.runTiming.runTimeLimitTimer);
    }
    await prepared.cleanup(execution?.state.dispatchState ?? null);
  }
}
