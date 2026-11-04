import type { TaskExecutionJob } from "@meowbert/shared";
import { recordRunCompletion, setTaskStatusForRun } from "../agent-db/index.js";
import { emitTaskEvent } from "../runtime/events.js";

// Idle compaction is background bookkeeping, so giving up leaves the task as it was. The next real
// run carries the context instead.
export async function settleFailedIdleCompaction(job: TaskExecutionJob, errorMessage: string): Promise<void> {
  await setTaskStatusForRun(job.taskId, job.runId, job.restoreStatus ?? "awaiting_input");
  await recordRunCompletion(job.runId, "error", errorMessage);
  await emitTaskEvent(job.taskId, "log", {
    message: `Idle context compaction stopped: ${errorMessage}`,
    trigger: "idle"
  });
}
