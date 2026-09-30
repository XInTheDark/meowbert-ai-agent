import type { TaskExecutionJob } from "@meowbert/shared";
import { maybeHandleCompactOnlyRun } from "./compact-only.js";
import { handleAgentRunFailure } from "./failure.js";
import { finalizeAgentRun } from "./finalize.js";
import { runAgentStepLoop } from "./loop.js";
import { initializeAgentExecution } from "./setup.js";
import { prepareAgentRunContext } from "./runtime.js";
import type { AgentFailureContext } from "./execution-types.js";
import { createTaskDebugLogger } from "../runtime/debug-task-events.js";

function buildFailureContext(job: TaskExecutionJob, prepared: Awaited<ReturnType<typeof prepareAgentRunContext>>): AgentFailureContext {
  return {
    job,
    prepared,
    state: {
      currentLeafMessageId: prepared.currentLeafMessageId
    }
  };
}

export async function runAgentJob(job: TaskExecutionJob): Promise<void> {
  const debugLogger = createTaskDebugLogger(job.taskId);
  await debugLogger.log("Worker claimed admitted run.", {
    stage: "worker.pickup",
    phase: "success",
    runId: job.runId,
    mode: job.mode ?? "default"
  });
  const prepared = await prepareAgentRunContext(job, debugLogger);
  let execution = null as Awaited<ReturnType<typeof initializeAgentExecution>> | null;

  try {
    execution = await initializeAgentExecution(job, prepared, debugLogger);
    if (await maybeHandleCompactOnlyRun(execution)) {
      return;
    }

    await runAgentStepLoop(execution);
    await finalizeAgentRun(execution);
  } catch (error) {
    await handleAgentRunFailure(execution ?? buildFailureContext(job, prepared), error);
  } finally {
    if (execution?.runControl.runTimeLimitTimer) {
      clearTimeout(execution.runControl.runTimeLimitTimer);
    }
    await prepared.cleanup(execution?.state.dispatchState ?? null);
  }
}
