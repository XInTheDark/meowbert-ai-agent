import type { ResponseInputItem } from "openai/resources/responses/responses";
import { parseRetryDeadlineMs, type TaskExecutionJob } from "@meowbert/shared";
import { selectRolloverSeedItems } from "../context-management-v2/rollover-seed.js";
import { recordContextItems } from "../context-management-v2/window.js";
import { resetV2ContextWindow } from "./context-window.js";
import type { AgentExecutionContext } from "./execution-types.js";

// Enough to read and rewrite a few notes; the turn is only bookkeeping.
const IDLE_COMPACTION_MAX_STEPS = 8;

const IDLE_COMPACTION_NOTE = [
  "This conversation has gone idle, so its context window will be cleared after this turn.",
  "Your recent messages with the user will stay. Update the note continuity.md now with anything else you need to pick up where you left off.",
  "Only the notes tools work here, and nothing you write reaches the user."
].join(" ");

export function isIdleCompactionRun(job: Pick<TaskExecutionJob, "mode" | "contextAction">): boolean {
  return job.mode === "compact_only" && job.contextAction === "idle";
}

// A run can sit in the queue past its deadline, so it checks before spending a request.
export function assertIdleCompactionNotExpired(job: Pick<TaskExecutionJob, "idleCompactionDeadlineAt">): void {
  const deadlineAtMs = parseRetryDeadlineMs(job.idleCompactionDeadlineAt);
  if (deadlineAtMs !== null && Date.now() >= deadlineAtMs) {
    throw new Error("The prompt cache window ended before idle compaction could run.");
  }
}

// The request is the next turn the conversation would send, with the note added at the end, so it
// reads the prompt cache the last turn wrote. The window is cleared once the model stops writing notes.
export async function runIdleCompaction(
  execution: AgentExecutionContext,
  runStepLoop: (execution: AgentExecutionContext) => Promise<void>
): Promise<void> {
  const { dispatchState } = execution.state;
  // Taken before the turn, whose own closing text is not part of the conversation with the user.
  const seedItems = selectRolloverSeedItems(dispatchState.conversationItems, { replies: true });
  const note: ResponseInputItem = { role: "developer", content: IDLE_COMPACTION_NOTE };
  dispatchState.conversationItems.push(note);
  dispatchState.runPersistedItems.push(note);

  execution.maxRunSteps = Math.min(execution.maxRunSteps, IDLE_COMPACTION_MAX_STEPS);
  await runStepLoop(execution);
  // Recorded only now: a failed compaction must not leave this note in the conversation's next run.
  if (execution.state.contextManagement.version === "v2") {
    await recordContextItems(execution.prepared.control.context, execution.state.contextManagement, [note]);
  }
  await resetV2ContextWindow(execution, "idle", seedItems);
}
